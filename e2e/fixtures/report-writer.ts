import fs from 'node:fs';
import path from 'node:path';
import { phase1Checklist } from './phase1-checklist';

const phase = process.argv[2] ?? 'phase-1';
const outputDir = path.resolve('docs/验收报告', phase);
const today = new Date().toISOString().slice(0, 10);
const reportPath = path.join(outputDir, `${today}-自动化验收.json`);

const report = {
  phase,
  验收时间: new Date().toISOString(),
  验收类型: '自动化验收',
  执行者: 'e2e-subagent',
  总体结果: '待填充',
  功能验收: {
    总项数: phase1Checklist.functionalIds.length,
    通过数: 0,
    失败数: 0,
    失败项清单: [],
  },
  视觉验收: {
    总项数: phase1Checklist.visualIds.length,
    通过数: 0,
    失败数: 0,
    失败项清单: [],
    截图对比结果: {
      总对比数: 0,
      像素差异率: '0%',
      异常对比: [],
    },
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(reportPath);
