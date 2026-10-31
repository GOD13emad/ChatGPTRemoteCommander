"""Bounded regression for the existing owner-private GUI worker. No GUI needed."""
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import types
from unittest import TestCase, main, mock

SRC = Path(__file__).resolve().parents[1] / "tools/rc-private-gui.py"
spec = importlib.util.spec_from_file_location("rc_private_gui", SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PrivateBusTests(TestCase):
    def test_accepts_only_current_owner_socket_tuple(self):
        addr = f"unix:path=/run/user/{os.getuid()}/at-spi/bus"
        self.assertEqual(mod.owner_at_spi_address(repr((addr,)),os.getuid()),addr)
        self.assertIsNone(mod.owner_at_spi_address(repr((addr,)),os.getuid()+1))
        self.assertIsNone(mod.owner_at_spi_address(repr((addr+";danger",)),os.getuid()))
        self.assertIsNone(mod.owner_at_spi_address("not-python-literal",os.getuid()))
        self.assertIsNone(mod.owner_at_spi_address(repr((addr,"another")),os.getuid()))
        self.assertIsNone(mod.owner_at_spi_address(repr(("tcp:host=outside",)),os.getuid()))

    def test_owner_bus_is_published_once_on_the_private_display(self):
        addr = f"unix:path=/run/user/{os.getuid()}/at-spi/bus"
        rc = lambda code,out="",err="": subprocess.CompletedProcess([],code,out,err)
        results=[rc(0,repr((addr,))),rc(0,"AT_SPI_BUS: no such atom on any window."),
                 rc(0),rc(0,f'AT_SPI_BUS(STRING) = "{addr}"')]
        calls=[]
        def fake_run(argv,**options):
            calls.append((argv,options))
            return results.pop(0)
        own_socket = types.SimpleNamespace(st_mode=stat.S_IFSOCK|0o600,st_uid=os.getuid())
        with mock.patch.object(mod.Path,"lstat",return_value=own_socket),mock.patch.object(mod,"run",side_effect=fake_run):
            self.assertTrue(mod.publish_owner_at_spi({"DISPLAY":":1960"}))
        self.assertEqual(len(calls),4)
        self.assertEqual(calls[2][0][:3],["/usr/bin/xprop","-root","-f"])
        self.assertEqual(calls[2][1]["env"],{"DISPLAY":":1960"})

    def test_does_not_replace_foreign_or_unknown_root_property(self):
        addr = f"unix:path=/run/user/{os.getuid()}/at-spi/bus"
        own_socket=types.SimpleNamespace(st_mode=stat.S_IFSOCK,st_uid=os.getuid())
        results=[subprocess.CompletedProcess([],0,repr((addr,))),
                 subprocess.CompletedProcess([],0,'AT_SPI_BUS(STRING) = "foreign"')]
        with mock.patch.object(mod.Path,"lstat",return_value=own_socket),mock.patch.object(mod,"run",side_effect=results) as runner:
            self.assertFalse(mod.publish_owner_at_spi({}))
        self.assertEqual(runner.call_count,2)

    def test_absent_or_foreign_bus_socket_fails_closed(self):
        foreign=types.SimpleNamespace(st_mode=stat.S_IFSOCK,st_uid=os.getuid()+1)
        with mock.patch.object(mod.Path,"lstat",return_value=foreign),mock.patch.object(mod,"run") as runner:
            self.assertFalse(mod.publish_owner_at_spi({}))
            runner.assert_not_called()


if __name__=="__main__":
    main()
