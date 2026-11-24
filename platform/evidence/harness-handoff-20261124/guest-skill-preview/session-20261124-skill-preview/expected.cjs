const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),path=require('node:path');
const dir=__dirname,raw=fs.readFileSync(path.join(dir,'previous-forge-receipt.json'));
const ui=vm.runInNewContext(fs.readFileSync(path.join(process.argv[2],'web/harness-ui.js'),'utf8')+'\nVillageHarness');
const bytes=Buffer.from(ui.skillMarkdown(JSON.parse(raw).new_skill),'utf8');
if(bytes.length!==539||crypto.createHash('sha256').update(bytes).digest('hex')!=='c7fff8facfdb5bf2aea7000b36cda913ada90f81a6b2425efcb2ca24baec2c80')throw Error('expected source mismatch');
fs.writeFileSync(path.join(dir,'expected-SKILL.md'),bytes,{flag:'wx'});
