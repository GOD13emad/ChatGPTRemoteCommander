import test from 'node:test';
import assert from 'node:assert/strict';
import {peerFromTailscaleStatus,createV2TailnetLoopbackRelay} from '../tools/v2-tailnet-loopback-relay.mjs';
const name='mmz-rustdesk.tail102f3b.ts.net.';
const fixture=(ip='100.80.5.112',online=true)=>JSON.stringify({
 BackendState:'Running',Peer:{node:{DNSName:name,Online:online,TailscaleIPs:[ip]}}
});
test('pinned online Tailscale peer resolves only a WireGuard CGNAT IPv4',()=>{
 assert.equal(peerFromTailscaleStatus(fixture(),name),'100.80.5.112');
});
test('offline, reused names, unexpected peer or non-tailnet IP fail closed',()=>{
 for(const [data,pin] of [
 [fixture('192.168.1.2'),name],[fixture('8.8.8.8'),name],
 [fixture('100.128.0.1'),name],[fixture('100.63.255.255'),name],
 [fixture('100.080.5.112'),name],[fixture('100.80.5.112',false),name],
 [JSON.stringify({BackendState:'Stopped',Peer:{}}),name],
 [JSON.stringify({BackendState:'Running',Peer:{
 one:{DNSName:name,Online:true,TailscaleIPs:['100.80.5.112']},
 two:{DNSName:name,Online:true,TailscaleIPs:['100.80.5.111']}
 }}),name],
 [fixture(), 'foreign.tail102f3b.ts.net.'],
 ['{bad JSON',name]
 ]){
  assert.throws(()=>peerFromTailscaleStatus(data,pin),{code:/^V2_RELAY_/});
 }
});
test('bootstrap rejects missing peer, invalid ports and invalid DNS names',()=>{
 for(const options of [
 {},{expectedDNS:name,localPort:80},{expectedDNS:name,remotePort:0},
 {expectedDNS:'http://untrusted',localPort:48789},
 {expectedDNS:name,lookup:null}
 ])assert.throws(()=>createV2TailnetLoopbackRelay(options),{code:'V2_RELAY_BOOTSTRAP_INVALID'});
});
test('peer lookup cannot cause a local listener for an unverified network address',async()=>{
 const relay=createV2TailnetLoopbackRelay({
  expectedDNS:name,localPort:48789,
  lookup:async()=> '127.0.0.1'
 });
 await assert.rejects(relay.listen(),{code:'V2_RELAY_PEER_IP_INVALID'});
 assert.equal(relay.listening,false);
});
