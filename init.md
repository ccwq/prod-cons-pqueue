我现在需要参考生产者消费者模式, 实现逻辑, 先我用伪代码来描述我的需求

```js

improt ProdCons from "prod-cons-js"

const pc = new ProdCons()

// 如果生产者生产的数据比消费者消费的快, 那么消费者需要等待生产者生产数据
pc.setSlotAmount(10)

pc.on("free-slot-amount-change", (n:number) => {
    
})

pc.on("blocked-state-change", (state:boolean) => {
    
})

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time))

// 生产者主动生产
for(let i = 0; i < 10; i++) {

    // 如果存在空闲的槽位, 就继续生产, 没有就停止
    await pc.hasFreeSlot()

    pc.produce(async () => {
        // 生产逻辑
        const data = await fetchData()
        return data
    })    
    await sleep(1000)
}

// 消费者被动消费
pc.consume(async (data) => {
    // 消费逻辑

    process(data)
    await sleep(2000)
})


pc.destroy()
// 清理所有监听
// 停止消费
// hasFreeSlot会直接reject
// pc.produce会warning log, "prod-cons已经停止"


// 行为
// - 当生产者生产的数据比消费者消费的快, 而且已经积压了slotNumber个数据, 则生产会停止, hasFreeSlot会等待
// - 


```

下面是我通过agent, 实现的3个版本
""""
好的，以下是分别用 **RxJS**、**AsyncQueue** 和 **PQueue** 实现您的需求的参考代码示例。每个示例都尽量还原您伪代码里的核心逻辑和API特性，便于您对比选择。

***

## 1. RxJS 实现

```js
import { Subject, BehaviorSubject, from, interval } from 'rxjs';
import { bufferCount, concatMap, takeUntil } from 'rxjs/operators';

class RxjsProdCons {
  constructor(slotAmount = 10) {
    this.slotAmount = slotAmount;
    this.queue$ = new Subject();
    this.stop$ = new Subject();
    this.dataBuffer = [];
    this.freeSlot$ = new BehaviorSubject(slotAmount);
    this.blocked$ = new BehaviorSubject(false);
  }

  setSlotAmount(n) {
    this.slotAmount = n;
    this.freeSlot$.next(n - this.dataBuffer.length);
  }

  async hasFreeSlot() {
    if (this.dataBuffer.length  {
      const sub = this.freeSlot$.subscribe(free => {
        if (free > 0) {
          sub.unsubscribe();
          resolve(true);
        }
      });
    });
  }

  async produce(fn) {
    await this.hasFreeSlot();
    const data = await fn();
    this.dataBuffer.push(data);
    this.freeSlot$.next(this.slotAmount - this.dataBuffer.length);
    this.queue$.next(data);
    if (this.dataBuffer.length >= this.slotAmount) {
      this.blocked$.next(true);
    }
  }

  consume(fn) {
    this.queue$.pipe(
      takeUntil(this.stop$),
      concatMap(async data => {
        await fn(data);
        this.dataBuffer.shift();
        this.freeSlot$.next(this.slotAmount - this.dataBuffer.length);
        this.blocked$.next(false);
      })
    ).subscribe();
  }

  on(type, callback) {
    if (type === 'free-slot-amount-change') {
      this.freeSlot$.subscribe(callback);
    }
    if (type === 'blocked-state-change') {
      this.blocked$.subscribe(callback);
    }
  }

  destroy() {
    this.stop$.next();
    this.freeSlot$.complete();
    this.blocked$.complete();
    this.queue$.complete();
  }
}
```

***

## 2. AsyncQueue 实现

AsyncQueue 是社区常用的 `async-queue` 或类似实现，这里以 `async-queue` 为例：

```js
import AsyncQueue from 'async-queue';

class AQProdCons {
  constructor(slotAmount = 10) {
    this.slotAmount = slotAmount;
    this.queue = new AsyncQueue({ concurrency: 1 });
    this.buffer = [];
    this.listeners = { 'free-slot-amount-change': [], 'blocked-state-change': [] };
  }

  setSlotAmount(n) { this.slotAmount = n; }

  async hasFreeSlot() {
    if (this.buffer.length  {
      const interval = setInterval(() => {
        if (this.buffer.length = this.slotAmount) this.emit('blocked-state-change', true);
    this.queue.push(async () => {
      await this.consumeFn(data);
      this.buffer.shift();
      this.emit('free-slot-amount-change', this.slotAmount - this.buffer.length);
      if (this.buffer.length  cb(value)); }

  destroy() {
    this.queue.clear();
    this.listeners = { 'free-slot-amount-change': [], 'blocked-state-change': [] };
  }
}
```

***

## 3. PQueue 实现

[PQueue (sindresorhus/p-queue)](https://github.com/sindresorhus/p-queue) 是 promise 队列库：

```js
import PQueue from 'p-queue';

class PQProdCons {
  constructor(slotAmount = 10) {
    this.queue = new PQueue({ concurrency: 1 });
    this.slotAmount = slotAmount;
    this.buffer = [];
    this.listeners = { 'free-slot-amount-change': [], 'blocked-state-change': [] };
    this.consuming = false;
  }

  setSlotAmount(n) { this.slotAmount = n; }

  async hasFreeSlot() {
    if (this.buffer.length  {
      const interval = setInterval(() => {
        if (this.buffer.length = this.slotAmount) this.emit('blocked-state-change', true);
    if (!this.consuming && this.consumeFn) this.consumeLoop();
  }

  consume(fn) {
    this.consumeFn = fn;
    this.consuming = true;
    this.consumeLoop();
  }

  async consumeLoop() {
    while (this.buffer.length > 0 && this.consuming) {
      const data = this.buffer[0];
      await this.consumeFn(data);
      this.buffer.shift();
      this.emit('free-slot-amount-change', this.slotAmount - this.buffer.length);
      if (this.buffer.length  cb(value)); }

  destroy() {
    this.consuming = false;
    this.buffer = [];
    this.listeners = { 'free-slot-amount-change': [], 'blocked-state-change': [] };
    this.queue.clear();
  }
}
```

***

### 小结对比

- **RxJS**：优势在于强大事件流和响应式管理，适合事件驱动、组合控制需求较多场景。
- **AsyncQueue**：代码简洁，易于理解，适合链式异步控制，有现成的并发与队列控制。
- **PQueue**：以promise为核心，可灵活设置并发数量，API简洁。

每种方案您都可以按需补充、定制。欢迎告知实际应用需求细节，以便进一步优化实现。
""""

我现在需要你创建一个前端项目, 基于最新的vite, 使用PQueue来实现这个工具, 封装为一个新的npm包,  需要包含下面的内容
- test代码和test script
- README.md
  - 包含介绍
  - 安装方法
  - 使用demo
  - api
  - 注意事项
- package.json
