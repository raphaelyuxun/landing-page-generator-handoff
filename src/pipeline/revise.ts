/**
 * Revision router — given the operator's free-text instruction, produce:
 *  - an "understanding" of the intent (Chinese) and a Todo list, for confirmation
 *  - a machine plan of what to regenerate (copy / banner / which product images)
 */
import { chatJSON } from '../aigw/client.js';
import type { ProductData } from '../types.js';

export interface RevisionPlan {
  understanding: string;
  todos: string[];
  copy: boolean;
  banner: boolean;
  productIndexes: number[];
}

const SYS = `你是落地页素材工具的"修改助手"。用户用自然语言描述想改的地方，你要：
1. 用一句话复述你对用户意图的理解（understanding，中文）。
2. 列出你将执行的具体待办（todos，中文，3 条以内，每条简短可执行）。
3. 判断需要"重新生成"哪些部分：
   - copy：页面文案（标题/副标题/卖点/认证/评价/FAQ/CTA/产品描述等任意文字）
   - banner：首屏横幅大图（hero 背景场景图）
   - 产品图：每个产品对应一张图，用其下标（从 0 开始）表示

判定规则：
- 涉及任何文字 → copy=true
- 涉及 banner/横幅/首图/首屏/背景大图/hero → banner=true
- 针对某个产品的图片（按名称或"产品N"匹配）→ 把该产品下标加入 productIndexes
- "所有产品图/全部产品图" → 列出全部产品下标
- 笼统整体风格调整（如"整体更高端""都换冷色调"）→ copy=true、banner=true、全部产品图
- 只提视觉风格但没指明产品 → banner=true 且全部产品图

只输出严格 JSON：
{ "understanding": string, "todos": string[], "copy": boolean, "banner": boolean, "productIndexes": number[] }
不要解释，不要 markdown。`;

export async function routeRevision(instruction: string, products: ProductData[]): Promise<RevisionPlan> {
  const list = products.map((p, i) => `[${i}] ${p.productName}`).join('\n');
  const fallback: RevisionPlan = {
    understanding: `按你的要求调整：${instruction}`,
    todos: ['重新生成相关文案'],
    copy: true,
    banner: false,
    productIndexes: [],
  };
  try {
    const plan = await chatJSON<RevisionPlan>(
      [
        { role: 'system', content: SYS },
        { role: 'user', content: `产品列表：\n${list || '(无)'}\n\n用户指令：${instruction}\n\n输出 JSON。` },
      ],
      { maxTokens: 500, temperature: 0.2 },
    );
    const n = products.length;
    const idxs = Array.isArray(plan.productIndexes)
      ? plan.productIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < n)
      : [];
    const result: RevisionPlan = {
      understanding: typeof plan.understanding === 'string' && plan.understanding.trim() ? plan.understanding.trim() : fallback.understanding,
      todos: Array.isArray(plan.todos) && plan.todos.length ? plan.todos.map(String) : [],
      copy: !!plan.copy,
      banner: !!plan.banner,
      productIndexes: [...new Set(idxs)],
    };
    if (!result.copy && !result.banner && result.productIndexes.length === 0) result.copy = true;
    if (!result.todos.length) {
      const parts = [result.copy && '重写文案', result.banner && '重做 banner', result.productIndexes.length ? `重做产品图 ${result.productIndexes.map((i) => i + 1).join(',')}` : ''].filter(Boolean) as string[];
      result.todos = parts;
    }
    return result;
  } catch {
    return fallback;
  }
}
