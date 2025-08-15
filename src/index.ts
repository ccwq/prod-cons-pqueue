import PQueue from 'p-queue';

type EventListener<T> = (value: T) => void;

export interface ProdConsOptions {
  slotAmount?: number;
  concurrency?: number;
}

export class ProdConsPQueue {
  private queue: PQueue;
  private buffer: any[];
  private slotAmount: number;
  private listeners: Map<string, Set<EventListener<any>>>;
  private consuming: boolean = false;
  private consumeFn: ((data: any) => Promise<void>) | null = null;
  private destroyed: boolean = false;
  private consumingPromise: Promise<void> | null = null;
  private waitingForSlot: Array<{ resolve: () => void }> = [];
  private isConsuming: boolean = false;
  private previousBlocked: boolean = false;
  private eventWaiters: Map<string, Array<{ resolve: (value: any) => void, condition?: (value: any) => boolean }>> = new Map();

  constructor(options: ProdConsOptions = {}) {
    const { slotAmount = 10, concurrency = 1 } = options;
    
    this.queue = new PQueue({ 
      concurrency,
      autoStart: true
    });
    this.buffer = [];
    this.slotAmount = slotAmount;
    this.listeners = new Map([
      ['free-slot-amount-change', new Set()],
      ['blocked-state-change', new Set()],
      ['destroy', new Set()]
    ]);
    this.eventWaiters = new Map();
    this.previousBlocked = false;
  }

  setSlotAmount(n: number): void {
    this.slotAmount = n;
    this.notifyStateChange();
    this.checkWaitingProducers();
  }

  getSlotAmount(): number {
    return this.slotAmount;
  }

  getBufferLength(): number {
    return this.buffer.length;
  }

  getFreeSlotAmount(): number {
    return Math.max(0, this.slotAmount - this.buffer.length);
  }

  isBlocked(): boolean {
    return this.buffer.length >= this.slotAmount;
  }

  async hasFreeSlot(): Promise<boolean> {
    if (this.destroyed) {
      throw new Error('ProdConsPQueue has been destroyed');
    }

    if (this.buffer.length < this.slotAmount) {
      return true;
    }

    return new Promise((resolve) => {
      this.waitingForSlot.push({ resolve: () => resolve(true) });
    });
  }

  // 新增方法：等待特定事件
  async waitForEvent(eventName: string, condition?: (value: any) => boolean): Promise<any> {
    if (this.destroyed) {
      throw new Error('ProdConsPQueue has been destroyed');
    }

    return new Promise((resolve) => {
      if (!this.eventWaiters.has(eventName)) {
        this.eventWaiters.set(eventName, []);
      }
      this.eventWaiters.get(eventName)!.push({ resolve, condition });
    });
  }

  private notifyEventWaiters(eventName: string, value: any): void {
    const waiters = this.eventWaiters.get(eventName);
    if (!waiters || waiters.length === 0) return;

    const toRemove: number[] = [];
    waiters.forEach((waiter, index) => {
      if (!waiter.condition || waiter.condition(value)) {
        waiter.resolve(value);
        toRemove.push(index);
      }
    });

    // 移除已完成的等待者
    toRemove.reverse().forEach(index => {
      waiters.splice(index, 1);
    });
  }

  private notifyStateChange(): void {
    if (this.destroyed) return;

    const currentFreeSlots = this.getFreeSlotAmount();
    const currentBlocked = this.isBlocked();

    // 触发空闲槽位变化事件
    this.emit('free-slot-amount-change', currentFreeSlots);

    // 只有在阻塞状态真正改变时才触发事件
    if (currentBlocked !== this.previousBlocked) {
      this.previousBlocked = currentBlocked;
      this.emit('blocked-state-change', currentBlocked);
    }
  }

  private checkWaitingProducers(): void {
    while (this.waitingForSlot.length > 0 && this.buffer.length < this.slotAmount) {
      const waiter = this.waitingForSlot.shift();
      if (waiter) {
        waiter.resolve();
      }
    }
  }

  async produce(fn: () => Promise<any>): Promise<void> {
    if (this.destroyed) {
      throw new Error('ProdConsPQueue has been destroyed');
    }

    await this.hasFreeSlot();
    
    const data = await fn();
    this.buffer.push(data);
    
    this.notifyStateChange();

    // 触发消费
    this.tryStartConsuming();
  }

  consume(fn: (data: any) => Promise<void>): void {
    if (this.destroyed) {
      throw new Error('ProdConsPQueue has been destroyed');
    }

    this.consumeFn = fn;
    this.consuming = true;
    this.tryStartConsuming();
  }

  private tryStartConsuming(): void {
    if (!this.consuming || this.destroyed || this.isConsuming || !this.consumeFn) {
      return;
    }

    if (this.buffer.length > 0) {
      this.startConsuming();
    }
  }

  private startConsuming(): void {
    if (this.isConsuming || !this.consuming || this.destroyed) {
      return;
    }

    this.isConsuming = true;
    this.consumingPromise = this.consumeLoop();
  }

  private async consumeLoop(): Promise<void> {
    while (this.consuming && !this.destroyed && this.buffer.length > 0 && this.consumeFn) {
      const data = this.buffer[0];
      
      try {
        await this.consumeFn(data);
        
        // 数据消费成功后，从缓冲区移除
        this.buffer.shift();
        this.notifyStateChange();

        // 通知等待的生产者
        this.checkWaitingProducers();
        
      } catch (error) {
        console.error('Error in consumer function:', error);
        // 即使出错也要移除数据，避免死循环
        this.buffer.shift();
        this.notifyStateChange();
        this.checkWaitingProducers();
      }

      // 让出控制权，避免阻塞事件循环
      await new Promise(resolve => setImmediate ? setImmediate(resolve) : setTimeout(resolve, 0));
    }

    this.isConsuming = false;
    this.consumingPromise = null;
  }

  // 等待所有数据被消费完
  async waitForEmpty(): Promise<void> {
    while (this.buffer.length > 0 && this.consuming && !this.destroyed) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  // 等待消费完成
  async waitForConsumption(): Promise<void> {
    if (this.consumingPromise) {
      await this.consumingPromise;
    }
    await this.waitForEmpty();
  }

  on(event: string, callback: EventListener<any>): void {
    if (this.destroyed) {
      return;
    }

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventListener<any>): void {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(callback);
    }
  }

  private emit(event: string, value: any): void {
    if (this.destroyed) {
      return;
    }

    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(value));
    }

    // 通知事件等待者
    this.notifyEventWaiters(event, value);
  }

  async pause(): Promise<void> {
    this.consuming = false;
    await this.queue.pause();
    
    // 等待当前消费完成
    if (this.consumingPromise) {
      await this.consumingPromise;
    }
  }

  async start(): Promise<void> {
    this.consuming = true;
    this.tryStartConsuming();
    await this.queue.start();
  }

  async clear(): Promise<void> {
    this.buffer = [];
    this.notifyStateChange();
    
    // 清理等待的生产者
    this.waitingForSlot.forEach(waiter => waiter.resolve());
    this.waitingForSlot = [];
    
    await this.queue.clear();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.consuming = false;
    this.consumeFn = null;
    
    // 清理等待的生产者
    this.waitingForSlot.forEach(waiter => waiter.resolve());
    this.waitingForSlot = [];
    
    // 清理事件等待者
    this.eventWaiters.forEach(waiters => {
      waiters.forEach(waiter => waiter.resolve(null));
    });
    this.eventWaiters.clear();
    
    await this.queue.pause();
    await this.queue.clear();
    
    // 等待消费循环完成
    if (this.consumingPromise) {
      await this.consumingPromise;
    }
    
    this.listeners.get('destroy')?.forEach(callback => callback(this));
    this.listeners.clear();
  }

  getStats(): {
    bufferLength: number;
    freeSlotAmount: number;
    isBlocked: boolean;
    pendingJobs: number;
    isPaused: boolean;
  } {
    return {
      bufferLength: this.buffer.length,
      freeSlotAmount: this.getFreeSlotAmount(),
      isBlocked: this.isBlocked(),
      pendingJobs: this.queue.pending,
      isPaused: this.queue.paused ?? false
    };
  }
}

export default ProdConsPQueue;