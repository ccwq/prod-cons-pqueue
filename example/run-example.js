#!/usr/bin/env node

import { execSync } from 'child_process';

console.log('=== ProdConsPQueue 示例演示 ===\n');

// 运行基础用法示例
console.log('1. 基础用法示例:');
console.log('node example/basic-usage.js\n');
execSync('node example/basic-usage.js', { stdio: 'inherit' });

// 等待几秒钟
setTimeout(() => {
  console.log('\n2. 高级用法示例:');
  console.log('node example/advanced-usage.js\n');
  execSync('node example/advanced-usage.js', { stdio: 'inherit' });
}, 1000);