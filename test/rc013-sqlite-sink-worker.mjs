import { Rc013SqliteEffectSink } from '../src/rc013-sqlite-effect-sink.mjs';
const sink=new Rc013SqliteEffectSink({databasePath:process.argv[2],verifyOwner:()=>false});
try{process.stdout.write(JSON.stringify(sink.increment(JSON.parse(process.argv[3]))))}
finally{sink.close()}
