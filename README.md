# ProdConsPQueue

基于 PQueue 的高效生产者-消费者模式实现，适用于 Node.js 和现代 JavaScript/TypeScript 环境。

## 特性

- 🚀 **高性能**: 基于 PQueue 实现，支持并发控制和任务调度
- 🎯 **精确控制**: 可配置的槽位数量和并发度
- 🔧 **事件驱动**: 支持实时状态监控和回调
- 🛡️ **错误处理**: 完善的错误处理和恢复机制
- 📊 **统计信息**: 提供详细的运行状态统计
- 🎨 **TypeScript 支持**: 完整的类型定义和开发体验

## 安装

```bash
npm install prod-cons-pqueue
```

## 快速开始

### 基础使用

```javascript
import ProdConsPQueue from 'prod-cons-pqueue';

// 创建生产者-消费者实例
const prodCons = new ProdConsPQueue({
  slotAmount: 10,  // 缓冲区大小
  concurrency: 2   // 消费并发度
});

// 监听状态变化
prodCons.on('free-slot-amount-change', (amount) => {
  console.log(`可用槽位数: ${amount}`);
});

prodCons.on('blocked-state-change', (isBlocked) => {
  console.log(`阻塞状态: ${isBlocked ? '阻塞' : '正常'}`);
});

// 设置消费者
prodCons.consume(async (data) => {
  console.log('消费数据:', data);
  await new Promise(resolve => setTimeout(resolve, 100));
  // 处理数据...
});

// 生产数据
for (let i = 0; i < 5; i++) {
  prodCons.produce(async () => {
    console.log('生产数据:', i);
    await new Promise(resolve => setTimeout(resolve, 50));
    return `item-${i}`;
  });
}
```

### 高级用法

```javascript
import ProdConsPQueue from 'prod-cons-pqueue';

const prodCons = new ProdConsPQueue({ 
  slotAmount: 5,
  concurrency: 3 
});

// 动态调整槽位数量
prodCons.setSlotAmount(20);

// 获取当前状态
console.log(prodCons.getStats());
// {
//   bufferLength: 5,
//   freeSlotAmount: 15,
//   isBlocked: false,
//   pendingJobs: 2,
//   isPaused: false
// }

// 批量生产数据
const batchProduce = async () => {
  for (let i = 0; i < 10; i++) {
    await prodCons.produce(async () => {
      console.log(`生产任务 ${i}`);
      // 模拟异步操作
      await new Promise(resolve => setTimeout(resolve, 100));
      return { id: i, data: `data-${i}` };
    });
  }
};

// 批量消费数据
const batchConsume = () => {
  prodCons.consume(async (item) => {
    console.log(`消费任务:`, item);
    // 模拟异步处理
    await new Promise(resolve => setTimeout(resolve, 200));
  });
};

// 启动生产者和消费者
batchProduce();
batchConsume();

// 控制功能
await prodCons.pause();  // 暂停消费
await prodCons.start();  // 继续消费
await prodCons.clear();  // 清空缓冲区
await prodCons.destroy(); // 销毁实例
```

## API 文档

### 构造函数

```typescript
constructor(options: ProdConsOptions = {})
```

**参数:**
- `options.slotAmount` (number): 缓冲区槽位数量，默认为 10
- `options.concurrency` (number): 消费并发度，默认为 1

### 实例方法

#### `setSlotAmount(n: number): void`
设置缓冲区槽位数量。

**参数:**
- `n`: 新的槽位数量

#### `getSlotAmount(): number`
获取当前槽位数量。

**返回值:**
- 当前槽位数量

#### `getBufferLength(): number`
获取当前缓冲区中的数据数量。

**返回值:**
- 缓冲区数据数量

#### `getFreeSlotAmount(): number`
获取可用槽位数量。

**返回值:**
- 可用槽位数量

#### `isBlocked(): boolean`
检查当前是否处于阻塞状态（缓冲区已满）。

**返回值:**
- 是否阻塞

#### `hasFreeSlot(): Promise<boolean>`
检查是否有可用槽位，如果没有则等待直到有可用槽位。

**返回值:**
- Promise<boolean>: 是否有可用槽位

#### `produce(fn: () => Promise<any>): Promise<void>`
生产数据并放入缓冲区。

**参数:**
- `fn`: 返回 Promise 的异步函数，用于产生数据

#### `consume(fn: (data: any) => Promise<void>): void`
设置消费者函数。

**参数:**
- `fn`: 处理数据的异步函数

#### `pause(): Promise<void>`
暂停消费操作。

#### `start(): Promise<void>`
继续消费操作。

#### `clear(): Promise<void>`
清空缓冲区。

#### `destroy(): Promise<void>`
销毁实例，释放资源。

#### `getStats(): Stats`
获取当前状态统计信息。

**返回值:**
```typescript
interface Stats {
  bufferLength: number;      // 缓冲区长度
  freeSlotAmount: number;    // 可用槽位数
  isBlocked: boolean;       // 是否阻塞
  pendingJobs: number;      // 待处理任务数
  isPaused: boolean;        // 是否暂停
}
```

### 事件监听

#### 事件类型

- `'free-slot-amount-change'`: 空闲槽位数量变化
- `'blocked-state-change'`: 阻塞状态变化
- `'destroy'`: 实例销毁

#### `on(event: string, callback: (value: any) => void): void`
添加事件监听器。

**参数:**
- `event`: 事件名称
- `callback`: 回调函数

#### `off(event: string, callback: (value: any) => void): void`
移除事件监听器。

**参数:**
- `event`: 事件名称
- `callback`: 要移除的回调函数

## 注意事项

1. **内存管理**: 建议在不需要时调用 `destroy()` 方法来释放资源
2. **错误处理**: 消费函数中的错误会被捕获并记录，不会影响队列的正常运行
3. **并发控制**: 合理设置 `concurrency` 参数以平衡性能和资源使用
4. **生产速度**: 当生产速度远大于消费速度时，缓冲区会被填满并进入阻塞状态
5. **资源清理**: 在应用退出前，确保调用 `destroy()` 方法

## 使用场景

### 1. 异步任务处理

```javascript
const taskQueue = new ProdConsPQueue({ 
  slotAmount: 20, 
  concurrency: 5 
});

// 处理文件上传任务
taskQueue.consume(async (file) => {
  await uploadFile(file);
});

// 提交上传任务
for (const file of files) {
  taskQueue.produce(async () => file);
}
```

### 2. 数据批处理

```javascript
const dataProcessor = new ProdConsPQueue({ 
  slotAmount: 50,
  concurrency: 10 
});

// 批量处理数据
dataProcessor.consume(async (dataBatch) => {
  const results = await processDataBatch(dataBatch);
  return results;
});

// 模拟数据流生成
async function* dataStream() {
  for (let i = 0; i < 1000; i++) {
    yield { id: i, data: generateRandomData() };
  }
}

// 生产数据
for await (const data of dataStream()) {
  await dataProcessor.produce(async () => data);
}
```

### 3. 限流控制

```javascript
const rateLimitedQueue = new ProdConsPQueue({ 
  slotAmount: 100,
  concurrency: 1 
});

// 限流API调用
rateLimitedQueue.consume(async (request) => {
  const response = await apiCall(request);
  return response;
});

// 高频请求
for (let i = 0; i < 1000; i++) {
  rateLimitedQueue.produce(async () => ({
    id: i,
    data: heavyComputation()
  }));
}
```

## 开发和测试

### 本地开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 运行测试
npm run test

# 运行测试覆盖率
npm run test:coverage

# 代码检查
npm run lint

# 类型检查
npm run type-check

# 构建项目
npm run build
```

### 发布到 npm

```bash
# 构建项目
npm run build

# 运行测试
npm run test

# 发布
npm publish
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### 1.0.0
- 初始发布
- 支持基本的生产者-消费者模式
- 事件驱动架构
- 完整的 TypeScript 支持
- 全面的测试覆盖