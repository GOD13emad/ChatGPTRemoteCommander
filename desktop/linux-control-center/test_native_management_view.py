"""Deterministic GTK-signal/confirmation unit fixture, not native X11 acceptance."""
import time
import unittest
from native_management import NativeManagementController
from native_management_view import attach_management_view


class Widget:
    def __init__(self, **props):
        self.props=props
        self.children=[]
        self.child=None
        self.parent=None
        self.handlers={}
        self.styles=set()
        self.sensitive=True
        self.text=props.get("label","")
    def add_css_class(self,x):self.styles.add(x)
    def remove_css_class(self,x):self.styles.discard(x)
    def set_text(self,x):self.text=x
    def get_text(self):return self.text
    def set_placeholder_text(self,x):self.props["placeholder"]=x
    def set_margin_top(self,x):pass
    def set_margin_bottom(self,x):pass
    def set_margin_start(self,x):pass
    def set_margin_end(self,x):pass
    def set_selection_mode(self,x):pass
    def set_activatable(self,x):pass
    def set_selectable(self,x):pass
    def set_visible(self,x):self.props["visible"]=x
    def set_sensitive(self,x):self.sensitive=x
    def append(self,w):w.parent=self;self.children.append(w)
    def remove(self,w):self.children.remove(w);w.parent=None
    def get_first_child(self):return self.children[0] if self.children else None
    def get_next_sibling(self):
        if self.parent is None:return None
        siblings=self.parent.children
        ix=siblings.index(self)
        return siblings[ix+1] if ix+1<len(siblings) else None
    def set_child(self,w):self.child=w;w.parent=self
    def get_child(self):return self.child
    def update_property(self,*args):pass
    def connect(self,signal,callback):self.handlers[signal]=callback
    def emit(self,signal,*args):
        if self.sensitive and signal in self.handlers:return self.handlers[signal](self,*args)


class Gtk:
    Box=Widget
    Label=Widget
    SearchEntry=Widget
    ListBox=Widget
    ListBoxRow=Widget
    Button=Widget
    class Orientation:VERTICAL=1;HORIZONTAL=2
    class SelectionMode:NONE=0
    class AccessibleProperty:LABEL=1


class Dialog:
    last=None
    def __init__(self,parent,title,body):
        self.parent=parent;self.title=title;self.body=body;self.responses={}
        self.handler=None
        self.default=None
        self.closed=False
        Dialog.last=self
    def add_response(self,kind,label):self.responses[kind]=label
    def set_default_response(self,v):self.default=v
    def set_close_response(self,v):self.close_name=v
    def set_response_appearance(self,*args):pass
    def connect(self,name,cb):self.handler=cb
    def present(self):pass
    def response(self,name):
        if self.handler:self.handler(self,name)
    def close(self):self.closed=True


class Adw:
    class ResponseAppearance:DESTRUCTIVE=1
    class MessageDialog:
        new=Dialog


class GLib:
    @staticmethod
    def idle_add(f,*args):return f(*args)


TARGET={"deviceId":"fixture","profileId":"default","configSha256":"a"*64,"routeGeneration":3}


class Client:
    target=TARGET
    def __init__(self):self.calls=[];self.mode="APPLIED";self.rows=None
    def control(self,action,workflow,revision,request):
        self.calls.append((action,workflow,revision,request))
        if self.mode=="FAIL":raise OSError("private endpoint")
        if self.mode=="REJECTED":
            return {"schema":1,"state":"REJECTED","code":"WORKFLOW_REVISION_CONFLICT","requestId":request,"action":action,"workflowId":workflow,"expectedRevision":revision,"target":TARGET,"newRevision":None}
        self.rows[0]["revision"]=revision+1
        self.rows[0]["state"]="PAUSED" if action=="workflow.pause" else "CANCELLED"
        return {"schema":1,"state":"APPLIED","code":"MANAGEMENT_CONTROL_READBACK_VERIFIED","requestId":request,"action":action,"workflowId":workflow,"expectedRevision":revision,"target":TARGET,"newRevision":revision+1,"controlIntent":self.rows[0]["state"]}


class Center:
    def __init__(self):self.window=object();self.tasks_page=Widget()


def await_state(view,marker):
    for _ in range(120):
        if marker in view.note.text:return
        time.sleep(.004)
    raise AssertionError("No bounded native-control result: "+view.note.text)


class NativeViewTests(unittest.TestCase):
    def setUp(self):
        Dialog.last=None
        self.client=Client()
        self.client.rows=[{"id":"alpha","revision":1,"state":"RUNNING","profileId":"default"}]
        self.controller=NativeManagementController(self.client,
            lambda:{"schema":1,"target":TARGET,"records":self.client.rows})
        self.center=Center()
        self.view=attach_management_view(self.center,self.controller,Gtk,Adw,GLib)
        self.addCleanup(self.view.close)

    def test_render_never_executes(self):
        self.assertEqual(len(self.view.buttons),2)
        self.assertEqual(self.client.calls,[])
        self.assertIn("profile default",self.view.target.text)

    def test_click_opens_dismiss_default_but_executes_nothing(self):
        self.view.buttons[0].emit("clicked")
        self.assertIsNotNone(Dialog.last)
        self.assertEqual(Dialog.last.default,"dismiss")
        self.assertIn("Revision: 1",Dialog.last.body)
        self.assertIn("Device: fixture",Dialog.last.body)
        self.assertEqual(self.client.calls,[])
        Dialog.last.response("dismiss")
        self.assertEqual(self.client.calls,[])

    def test_confirmed_pause_uses_native_client_once_and_reports_only_control_intent(self):
        self.view.buttons[0].emit("clicked")
        Dialog.last.response("confirm")
        await_state(self.view,"APPLIED")
        self.assertEqual(len(self.client.calls),1)
        self.assertEqual(self.client.calls[0][0],"workflow.pause")
        self.assertIn("worker",self.view.note.text)
        self.assertEqual(self.client.rows[0]["revision"],2)
        self.assertEqual(len(self.view.buttons),1)  # pause no longer applies

    def test_confirmed_cancel_is_destructive_only_after_dialog(self):
        self.view.buttons[1].emit("clicked")
        self.assertEqual(len(self.client.calls),0)
        Dialog.last.response("confirm")
        await_state(self.view,"APPLIED")
        self.assertEqual(len(self.client.calls),1)
        self.assertEqual(self.client.calls[0][0],"workflow.cancel")
        self.assertEqual(self.view.buttons,[])

    def test_transport_uncertain_has_no_retry_and_no_enabled_controls(self):
        self.client.mode="FAIL"
        self.view.buttons[0].emit("clicked")
        Dialog.last.response("confirm")
        await_state(self.view,"UNCERTAIN")
        self.assertEqual(len(self.client.calls),1)
        self.assertTrue(self.controller.disabled)
        self.assertFalse(any(b.sensitive for b in self.view.buttons))
        self.view.refresh()
        self.assertEqual(len(self.client.calls),1)

    def test_rejected_is_not_success(self):
        self.client.mode="REJECTED"
        self.view.buttons[0].emit("clicked")
        Dialog.last.response("confirm")
        await_state(self.view,"REJECTED")
        self.assertEqual(len(self.client.calls),1)
        self.assertFalse(self.controller.disabled)

    def test_stale_snapshot_cannot_confirm_old_revision(self):
        button=self.view.buttons[0]
        self.client.rows[0]["revision"]=2
        button.emit("clicked")
        self.assertIsNone(Dialog.last)
        self.assertEqual(self.client.calls,[])

    def test_scope_mismatch_disables_controls(self):
        self.client.rows[0]["profileId"]="other"
        self.view.refresh()
        self.assertIn("blocked",self.view.note.text.lower())
        self.assertEqual(self.view.buttons,[])

    def test_unknown_target_never_displays_action_buttons(self):
        self.client.rows[0]["revision"]=True
        self.view.refresh()
        self.assertEqual(self.view.buttons,[])
        self.assertEqual(self.client.calls,[])

    def test_close_prevents_any_control(self):
        self.view.close()
        self.view.confirm("alpha",1,"workflow.pause")
        self.assertIsNone(Dialog.last)
        self.assertFalse(any(b.sensitive for b in self.view.buttons))


    def test_view_never_promotes_missing_schema_receipt(self):
        native=self.client.control
        def malformed(*args):
            result=native(*args)
            result.pop("schema")
            return result
        self.client.control=malformed
        self.view.buttons[0].emit("clicked")
        Dialog.last.response("confirm")
        await_state(self.view,"UNCERTAIN")
        self.assertTrue(self.controller.disabled)
        self.assertEqual(len(self.client.calls),1)
        self.assertFalse(any(b.sensitive for b in self.view.buttons))

if __name__=="__main__":unittest.main()
