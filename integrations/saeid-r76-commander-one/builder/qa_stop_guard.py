"""Private QA Stop consumption, never a product cancellation implementation."""
import hashlib
import json
import os
from pathlib import Path
import uuid

class QaStopGuard:
    def __init__(self, root, profile):
        self.root = Path(root).resolve()
        self.profile = profile
        self.generation = None
        self.consumed = False
        self.launch_verified = False
        self.attempt = None

    def after_verified_start(self, receipt):
        if not (receipt.get('started') is True and receipt.get('verifiedHealth') is True
                and receipt.get('profile') == self.profile):
            raise RuntimeError('QA_START_GENERATION_UNVERIFIED')
        self.generation = uuid.uuid4().hex
        self.launch_verified = True
        self.consumed = False
        self.attempt = None

    def _append(self, kind, **extra):
        directory = self.root.parent / '.qa-stop-attempts'
        if directory.is_symlink():raise RuntimeError('QA_STOP_LEDGER_ALIAS')
        directory.mkdir(exist_ok=True)
        file = directory / (self.profile+'-'+self.generation+'-'+uuid.uuid4().hex+'.json')
        with file.open('x', encoding='utf8') as stream:
            json.dump(dict(schema=1, kind=kind, rootFingerprint=hashlib.sha256(
                str(self.root).encode()).hexdigest(), profile=self.profile,
                generation=self.generation, attempt=self.attempt, **extra), stream)
            stream.flush();os.fsync(stream.fileno())
        return file

    def consume(self, channel):
        if not self.launch_verified or not self.generation:raise RuntimeError('QA_STOP_START_OUTCOME_UNVERIFIED_RETAIN')
        if self.consumed:raise RuntimeError('QA_STOP_ALREADY_CONSUMED_NO_REPLAY')
        # Also stays consumed if persisting fails; no effect may then be sent.
        self.consumed=True;self.attempt=uuid.uuid4().hex
        return self._append('CONSUMED_BEFORE_STOP',channel=channel)

    def stop_once(self, dispatch, channel='cli'):
        self.consume(channel)
        return dispatch()

    def resolve_rejected_probe_no_effect(self, rejected, running):
        if (not self.consumed or rejected.get('errorCode')!='INSTALLER_CONTROL_IDENTITY_MISMATCH'
            or running.get('profile')!=self.profile or running.get('running') is not True
            or running.get('verified') is not True):raise RuntimeError('QA_STOP_PROBE_NOT_PROVEN_NO_EFFECT')
        self._append('KNOWN_NOT_SUBMITTED_IDENTITY_REJECTION')
        self.consumed=False

    def summary(self):
        return dict(profile=self.profile,generation=self.generation,
                    launchVerified=self.launch_verified,stopConsumed=self.consumed)

def retain_recovery(root,primary,guards=(),secondary=()):
    receipt=dict(schema=1,status='QA_RECOVERY_RETAINED_NO_STOP_REPLAY',root=str(Path(root)),
                 primaryType=type(primary).__name__ if primary else None,
                 guards=[g.summary() for g in guards],secondaryTypes=[type(e).__name__ for e in secondary])
    try:
        with (Path(root)/('qa-recovery-'+uuid.uuid4().hex+'.json')).open('x',encoding='utf8') as stream:
            json.dump(receipt,stream);stream.flush();os.fsync(stream.fileno())
    except BaseException as error:print('QA_SECONDARY_RECOVERY_RECEIPT_FAILURE='+type(error).__name__)
    print('QA_RECOVERY_ROOT='+str(root))

def cleanup_once(guards,dispatch,observe,no_control_file,primary):
    errors=[]
    for guard in guards:
        try:
            state=observe(guard.profile)
            def stopped(s):
                return (s.get('ok') is True and s.get('profile')==guard.profile
                    and s.get('running') is False and s.get('verified') is False)
            if stopped(state) and no_control_file(guard.profile):continue
            running=(state.get('ok') is True and state.get('profile')==guard.profile
                and state.get('running') is True and state.get('verified') is True)
            if guard.launch_verified and not guard.consumed and running:
                guard.stop_once(lambda:dispatch(guard.profile),'finally-fresh-stop')
                state=observe(guard.profile)
            if not stopped(state) or not no_control_file(guard.profile):
                raise RuntimeError('QA_STOP_UNSETTLED_RETAIN_NO_REPLAY')
        except BaseException as error:
            errors.append(error);print('QA_SECONDARY_CLEANUP_FAILURE='+type(error).__name__)
    if errors and primary is None:raise errors[0]
    return errors
