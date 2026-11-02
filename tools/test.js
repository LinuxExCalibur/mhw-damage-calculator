const fs = require('fs');

const htmlPath = process.argv[2];
const html = fs.readFileSync(htmlPath, 'utf8');

// 取出从数据定义到渲染函数之前的纯逻辑部分（不含 DOM 操作）
const start = html.indexOf('const MHW_DATA');
const end = html.indexOf('/* ---------- 渲染：怪物与部位');
if (start < 0 || end < 0) { console.error('FAIL: 无法定位脚本片段'); process.exit(1); }
const code = html.slice(start, end);

let ctx = {};
const fn = new Function(code + '\nreturn {MHW_DATA, WEP, SHARP, compute, expVal, ATK_TYPE, CRIT_BOOST};');
ctx = fn();

const { MHW_DATA, compute, WEP, SHARP } = ctx;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL: ' + msg); } };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

console.log('加载怪物数: ' + MHW_DATA.length);

// 1. 数据完整性
MHW_DATA.forEach(m => {
  ok(m.parts && m.parts.length >= 2, `${m.name} 部位数异常`);
  m.parts.forEach(p => {
    ['cut','blunt','ranged','fire','water','thunder','ice','dragon'].forEach(k => {
      ok(typeof p[k] === 'number' && p[k] >= 0 && p[k] <= 200, `${m.name}/${p.part} 字段 ${k} 异常: ${p[k]}`);
    });
  });
});

// 2. 取灭尽龙头部核对（页面原始值 45/60/40, 火5 水10 雷15 冰15 龙5）
const nerg = MHW_DATA.find(m => m.slug === 'aYaUV');
const head = nerg.parts.find(p => p.part === '头部');
ok(head.cut === 45 && head.blunt === 60 && head.ranged === 40, '灭尽龙头部物理肉质不符');
ok(head.fire === 5 && head.water === 10 && head.thunder === 15 && head.ice === 15 && head.dragon === 5, '灭尽龙头部属性肉质不符');
console.log('灭尽龙头部: ' + JSON.stringify(head));

// 3. 纯物理计算核对：太刀 1000 攻击、白斩、MV100、肉质45、0 会心
const build = {weapon:'太刀', atk:1000, eleDisp:0, element:'无', aff:0, sharp:'白',
               atkLv:0, eyeLv:0, wexLv:0, cbLv:2, critEle:'none', extraRaw:0, pctBonus:0, eleExtra:0};
const opts = {mv:100, monMod:1, soft:false};
const r = compute(build, nerg, head, opts);

// 真实攻击力 = 1000/3.3 = 303.03；物理 = 303.03 × 1 × 1.32 × 0.45 = 180.0
ok(near(r.trueRaw, 1000/3.3, 0.01), '真实攻击力计算错误: ' + r.trueRaw);
ok(near(r.physBase, 180.0, 0.1), '物理非会心计算错误: ' + r.physBase);
// 超会心2 → 1.35 倍
ok(near(r.physCrit, 180.0*1.35, 0.2), '物理会心计算错误: ' + r.physCrit);
// 0 会心 → 期望 = 非会心
ok(near(r.physExp, r.physBase, 0.01), '0 会心时期望应等于非会心');

// 4. 会心期望：50% 会心
const b50 = Object.assign({}, build, {aff:50});
const r50 = compute(b50, nerg, head, opts);
ok(near(r50.physExp, 180.0*0.5 + 180.0*1.35*0.5, 0.2), '50% 会心期望计算错误: ' + r50.physExp);

// 5. 负会心：-30 → 期望 = 0.7×非会心 + 0.3×0.75×非会心
const bneg = Object.assign({}, build, {aff:-30});
const rneg = compute(bneg, nerg, head, opts);
ok(near(rneg.physExp, 180.0*0.7 + 180.0*0.75*0.3, 0.2), '负会心期望计算错误: ' + rneg.physExp);

// 6. 攻击技能：攻击 Lv7 (+21, +10%)
const bA = Object.assign({}, build, {atkLv:7});
const rA = compute(bA, nerg, head, opts);
// trueRaw 不含百分比，rawTotal 才含
ok(near(rA.trueRaw, 1000/3.3 + 21, 0.01), '攻击 Lv7 trueRaw 错误: ' + rA.trueRaw);
ok(near(rA.rawTotal, (1000/3.3 + 21)*1.10, 0.01), '攻击 Lv7 rawTotal 错误: ' + rA.rawTotal);

// 7. 弱点特效：肉质45 应触发 +30；肉质44 不应触发
const wex = Object.assign({}, build, {wexLv:3});
ok(near(compute(wex, nerg, head, opts).aff, 30, 0.01), '弱特3 在肉质45时未生效');
const bodyPart = nerg.parts.find(p => p.part === '身体'); // cut 35
ok(near(compute(wex, nerg, bodyPart, opts).aff, 0, 0.01), '弱特3 在肉质35时不应生效');

// 8. 属性计算：火龙头部 雷属性
const rath = MHW_DATA.find(m => m.name === '火龙');
if (rath) {
  const rhead = rath.parts.find(p => p.part.indexOf('头部') === 0);
  const be = Object.assign({}, build, {element:'雷', eleDisp:300, critEle:'element', aff:100});
  const re = compute(be, rath, rhead, opts);
  const trueEle = 300/10;
  const expBase = trueEle * SHARP['白'].ele * (rhead.thunder/100);
  ok(near(re.eleBase, expBase, 0.01), '属性非会心计算错误: ' + re.eleBase);
  ok(near(re.eleCrit, expBase*1.35, 0.01), '属性会心(1.35)计算错误: ' + re.eleCrit);
  console.log('火龙头部 雷30 白斩: 非会心=' + re.eleBase.toFixed(2) + ' 会心=' + re.eleCrit.toFixed(2));
}

// 9. 软化：45 → 0.75*45+25 = 58.75
const rsoft = compute(build, nerg, head, {mv:100, monMod:1, soft:true});
ok(near(rsoft.zoneRaw, 58.75, 0.01), '软化肉质计算错误: ' + rsoft.zoneRaw);

// 10. 所有怪物 + 所有部位都能跑通不报错
let combos = 0;
MHW_DATA.forEach(m => m.parts.forEach(p => {
  ['大剑','大锤','弓箭'].forEach(w => {});
  try {
    compute(build, m, p, opts);
    compute(b50, m, p, opts);
    combos += 2;
  } catch (e) { fails++; console.log('FAIL: ' + m.name + '/' + p.part + ' 计算抛错 ' + e.message); }
}));

console.log('计算组合数: ' + combos);
console.log(fails === 0 ? '=== ALL TESTS PASSED ===' : '=== FAILURES: ' + fails + ' ===');
process.exit(fails === 0 ? 0 : 1);
