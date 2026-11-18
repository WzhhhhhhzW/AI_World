const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('file entry shows launch guidance without fetching game data or scripts',async()=>{
  const appended=[];
  const body={className:'game-mode',append:element=>appended.push(element)};
  const document={body,createElement:()=>({id:'',innerHTML:''})};
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../web/boot.js'),'utf8'),{document,location:{protocol:'file:'}});
  assert.equal(body.className,'launch-mode');
  assert.equal(appended.length,1);
  assert.equal(appended[0].id,'launch-cover');
  assert.match(appended[0].innerHTML,/启动游戏\.cmd/);
  assert.match(appended[0].innerHTML,/http:\/\/127\.0\.0\.1:8766\//);
});
