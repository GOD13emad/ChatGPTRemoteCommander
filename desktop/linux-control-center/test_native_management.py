import unittest
from native_management import NativeManagementController, ManagementBlocked

T = {"deviceId":"fixture","profileId":"default","configSha256":"a"*64,"routeGeneration":2}

class FakeClient:
    target = T
    def __init__(self):
        self.calls=[]
        self.effect="APPLIED"
    def control(self,action,id,revision,request_id):
        self.calls.append((action,id,revision,request_id))
        if self.effect=="ERROR": raise TimeoutError("secret or path")
        if self.effect=="REJECTED":
            return {"schema":1,"state":"REJECTED","code":"WORKFLOW_REVISION_CONFLICT","requestId":request_id,"action":action,"workflowId":id,"expectedRevision":revision,"target":T,"newRevision":None}
        if self.effect=="SPOOF":
            return {"schema":1,"state":"APPLIED","code":"MANAGEMENT_CONTROL_READBACK_VERIFIED","requestId":request_id,"action":action,"workflowId":"other","expectedRevision":revision,"target":T,"newRevision":revision+1,"controlIntent":"PAUSED"}
        return {"schema":1,"state":"APPLIED","code":"MANAGEMENT_CONTROL_READBACK_VERIFIED","requestId":request_id,"action":action,"workflowId":id,"expectedRevision":revision,"target":T,"newRevision":revision+1,"controlIntent":"PAUSED" if action=="workflow.pause" else "CANCELLED"}

class ManagementTests(unittest.TestCase):
    def setUp(self):
        self.client=FakeClient()
        self.records=[{"id":"alpha","profileId":"default","revision":1,"state":"RUNNING"}]
        self.inventory=lambda:{"schema":1,"target":T,"records":self.records}
        self.controller=NativeManagementController(self.client,self.inventory)

    def prepare(self,action="workflow.pause"):
        return self.controller.prepare("alpha",1,action)

    def test_preparation_has_no_side_effect(self):
        proposal=self.prepare()
        self.assertEqual(proposal.revision,1)
        self.assertEqual(self.client.calls,[])
        self.assertEqual(self.controller.target,T)
        self.controller.target["profileId"]="bad"
        self.assertEqual(self.controller.target["profileId"],"default")

    def test_two_explicit_operations_verified(self):
        for action in ("workflow.pause","workflow.cancel"):
            with self.subTest(action=action):
                result=self.controller.submit_confirmed(self.prepare(action))
                self.assertEqual(result["state"],"APPLIED")
        self.assertEqual(len(self.client.calls),2)

    def test_stale_revision_is_rejected_without_effect(self):
        prop=self.prepare()
        self.records[0]={"id":"alpha","profileId":"default","revision":2,"state":"RUNNING"}
        with self.assertRaisesRegex(ManagementBlocked,"MANAGEMENT_WORKFLOW_CHANGED"):
            self.controller.submit_confirmed(prop)
        self.assertEqual(self.client.calls,[])

    def test_changed_lifecycle_is_rejected(self):
        prop=self.prepare()
        self.records[0]["state"]="PAUSED"
        with self.assertRaisesRegex(ManagementBlocked,"MANAGEMENT_WORKFLOW_CHANGED"):
            self.controller.submit_confirmed(prop)

    def test_completed_cannot_be_controlled(self):
        self.records[0]["state"]="COMPLETED"
        with self.assertRaisesRegex(ManagementBlocked,"MANAGEMENT_ACTION_NOT_APPLICABLE"):
            self.prepare()

    def test_paused_cannot_pause_twice(self):
        self.records[0]["state"]="PAUSED"
        with self.assertRaisesRegex(ManagementBlocked,"MANAGEMENT_ACTION_NOT_APPLICABLE"):
            self.prepare("workflow.pause")
        self.assertEqual(self.prepare("workflow.cancel").action,"workflow.cancel")

    def test_rejected_receipt_is_not_success(self):
        self.client.effect="REJECTED"
        r=self.controller.submit_confirmed(self.prepare())
        self.assertEqual(r["state"],"REJECTED")
        self.assertFalse(self.controller.disabled)

    def test_unknown_rejection_code_never_unlocks_an_uncertain_effect(self):
        genuine=self.client.control
        def mislabeled(*args):
            result=genuine(*args)
            result["state"]="REJECTED"
            result["code"]="MANAGEMENT_OUTCOME_UNCERTAIN"
            result["newRevision"]=None
            result.pop("controlIntent",None)
            return result
        self.client.control=mislabeled
        result=self.controller.submit_confirmed(self.prepare())
        self.assertEqual(result["state"],"UNCERTAIN")
        self.assertEqual(result["code"],"MANAGEMENT_RESULT_UNVERIFIED")
        self.assertTrue(self.controller.disabled)
        self.assertEqual(len(self.client.calls),1)

    def test_known_native_expiration_no_effect_stays_rejected(self):
        genuine=self.client.control
        def expired(*args):
            result=genuine(*args)
            result["state"]="REJECTED"
            result["code"]="MANAGEMENT_EXPIRED_BEFORE_EFFECT"
            result["newRevision"]=None
            result.pop("controlIntent",None)
            return result
        self.client.control=expired
        self.assertEqual(self.controller.submit_confirmed(self.prepare())["state"],"REJECTED")
        self.assertFalse(self.controller.disabled)

    def test_uncertain_transport_disables_all_future_commands(self):
        self.client.effect="ERROR"
        r=self.controller.submit_confirmed(self.prepare())
        self.assertEqual(r["state"],"UNCERTAIN")
        self.assertTrue(self.controller.disabled)
        with self.assertRaisesRegex(ManagementBlocked,"MANAGEMENT_SESSION_UNAVAILABLE"):
            self.prepare()

    def test_spoofed_response_is_not_success(self):
        self.client.effect="SPOOF"
        self.assertEqual(self.controller.submit_confirmed(self.prepare())["state"],"UNCERTAIN")
        self.assertTrue(self.controller.disabled)

    def test_malformed_inventory_is_rejected(self):
        for data in ({"schema":True,"target":T,"records":self.records},
                     {"schema":1,"target":{**T,"routeGeneration":3},"records":self.records},
                     {"schema":1,"target":T,"records":[self.records[0]]*2},
                     {"schema":1,"target":T,"records":[{**self.records[0],"revision":True}]},
                     {"schema":1,"target":T,"records":[{**self.records[0],"profileId":"other"}]},
                     {"schema":1,"target":T,"records":[{**self.records[0],"id":"../evil"}]},
                     {"schema":1,"target":T,"records":None}):
            with self.subTest(data=data):
                bad=NativeManagementController(self.client,lambda x=data:x)
                with self.assertRaises(ManagementBlocked):
                    bad.list_controls()
        self.assertFalse(self.client.calls)

    def test_wrong_actions_and_revisions(self):
        for action in ("workflow.resume","shell.execute","delivery.ack",None,["workflow.pause"]):
            with self.subTest(action=action),self.assertRaises(ManagementBlocked):
                self.prepare(action)
        for revision in (True,0,-1,"1",10001):
            with self.subTest(revision=revision),self.assertRaises(ManagementBlocked):
                self.controller.prepare("alpha",revision,"workflow.pause")

    def test_wrong_target_proposal_denied(self):
        prop=self.prepare()
        from dataclasses import replace
        with self.assertRaisesRegex(ManagementBlocked,"MANAGEMENT_PROPOSAL_UNVERIFIED"):
            self.controller.submit_confirmed(replace(prop,target=(("profileId","other"),)))


    def test_one_confirmation_token_cannot_dispatch_twice_after_rejection(self):
        self.client.effect="REJECTED"
        proposal=self.prepare()
        result=self.controller.submit_confirmed(proposal)
        self.assertEqual(result["state"],"REJECTED")
        with self.assertRaisesRegex(ManagementBlocked,"MANAGEMENT_PROPOSAL_CONSUMED"):
            self.controller.submit_confirmed(proposal)
        self.assertEqual(len(self.client.calls),1)

    def test_unprepared_or_superseded_proposal_cannot_dispatch(self):
        from dataclasses import replace
        proposal=self.prepare()
        with self.assertRaisesRegex(ManagementBlocked,"MANAGEMENT_PROPOSAL_CONSUMED"):
            self.controller.submit_confirmed(replace(proposal,request_id="forged"))
        assert not self.client.calls
        newer=self.prepare()
        with self.assertRaisesRegex(ManagementBlocked,"MANAGEMENT_PROPOSAL_CONSUMED"):
            self.controller.submit_confirmed(proposal)
        self.assertEqual(self.controller.submit_confirmed(newer)["state"],"APPLIED")
        self.assertEqual(len(self.client.calls),1)

    def test_missing_or_wrong_receipt_schema_never_claims_applied(self):
        for invalid in (None,True,2,"1"):
            with self.subTest(schema=invalid):
                item=FakeClient()
                records=[{"id":"alpha","profileId":"default","revision":1,"state":"RUNNING"}]
                control=NativeManagementController(item,lambda:{"schema":1,"target":T,"records":records})
                valid=item.control
                def fake(*args, value=invalid):
                    result=valid(*args)
                    if value is None:result.pop("schema")
                    else:result["schema"]=value
                    return result
                item.control=fake
                outcome=control.submit_confirmed(control.prepare("alpha",1,"workflow.pause"))
                self.assertEqual(outcome["state"],"UNCERTAIN")
                self.assertTrue(control.disabled)

if __name__=="__main__":unittest.main()
