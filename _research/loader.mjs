/**
 * Node ESM 解析补丁：补 .ts / .js 后缀、把目录解析到 index。
 * Cocos 构建器支持省略后缀，Node 不支持，所以只在跑测试时挂这个钩子。
 * TypeScript 本身靠 Node 24 内置的类型擦除直接跑，不需要额外编译步骤。
 */

import { registerHooks } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.')) throw err;
      const base = new URL(specifier, context.parentURL).href;
      for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.js`, `${base}/index.js`]) {
        if (fs.existsSync(fileURLToPath(candidate))) {
          // 不指定 format，让 Node 按后缀自己判断——.ts 才会走内置的类型擦除
          return { url: candidate, shortCircuit: true };
        }
      }
      throw err;
    }
  },
});
