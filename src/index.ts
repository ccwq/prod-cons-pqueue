import PQueue from 'p-queue';

/**
 * 定义一个通用的事件监听器函数类型
 * @template T - 事件传递的值的类型
 * @param {T} value - 事件触发时传递的值
 */
type EventListener<T> = (value: T) => void;

/**
 * ProdConsPQueue 类的构造函数选项
 */
export interface ProdConsOptions {
    /**
     * 缓冲区中的槽位数量, 代表生产者可以放入的最大项目数。
     * 这用于实现背压 (backpressure)。
     * @default 10
     */
    slotAmount?: number;
    /**
     * 消费者函数的最大并发数。
     * @default 1
     */
    concurrency?: number;
}

// 一个 setImmediate 的 polyfill，以确保在不同环境中行为一致
const setImmediate = globalThis.setImmediate || function (fn) {
    setTimeout(fn, 0);
};

/**
 * 一个基于 p-queue 的生产者-消费者模型实现。
 * 它提供了一个带槽位限制的缓冲区，用于控制生产速度（背压），
 * 并使用 p-queue 来管理消费者的并发执行。
 * 支持事件监听、暂停、恢复和销毁等功能。
 *
 * @example
 * ```typescript
 * const queue = new ProdConsPQueue({ slotAmount: 5, concurrency: 2 });
 *
 * // 设置消费者
 * queue.consume(async (data) => {
 *   console.log('Consuming:', data);
 *   // 模拟异步操作
 *   await new Promise(resolve => setTimeout(resolve, 1000));
 * });
 *
 * // 生产者
 * for (let i = 0; i < 10; i++) {
 *   console.log('Producing:', i);
 *   await queue.produce(async () => {
 *     // 模拟异步生产
 *     await new Promise(resolve => setTimeout(resolve, 100));
 *     return `item-${i}`;
 *   });
 * }
 *
 * await queue.waitForConsumption();
 * console.log('All items have been consumed.');
 * ```
 */
export class ProdConsPQueue {
    /**
     * @private
     * p-queue 实例，用于管理并发消费任务
     */
    private queue: PQueue;
    /**
     * @private
     * 存储已生产但尚未消费的数据的内部缓冲区
     */
    private buffer: any[];
    /**
     * @private
     * 缓冲区的最大容量
     */
    private slotAmount: number;
    /**
     * @private
     * 存储事件监听器的 Map
     */
    private listeners: Map<string, Set<EventListener<any>>>;
    /**
     * @private
     * 标记是否正在进行消费
     */
    private consuming: boolean = false;
    /**
     * @private
     * 用户提供的消费函数
     */
    private consumeFn: ((data: any) => Promise<void>) | null = null;
    /**
     * @private
     * 标记实例是否已被销毁
     */
    private destroyed: boolean = false;
    /**
     * @private
     * 存储等待可用槽位的生产者的 Promise 解析函数
     */
    private waitingForSlot: Array<{ resolve: () => void }> = [];
    /**
     * @private
     * 缓存上一次的阻塞状态，用于触发 'blocked-state-change' 事件
     */
    private previousBlocked: boolean = false;
    /**
     * @private
     * 存储等待特定事件的 Promise 解析函数
     */
    private eventWaiters: Map<string, Array<{ resolve: (value: any) => void, condition?: (value: any) => boolean }>> = new Map();
    /**
     * @private
     * 跟踪当前正在执行的任务数（p-queue中正在运行的任务）
     */
    private runningJobs: number = 0;

    /**
     * 创建一个 ProdConsPQueue 实例。
     * @param {ProdConsOptions} [options={}] - 配置选项。
     * @param {number} [options.slotAmount=10] - 缓冲区的槽位数量。
     * @param {number} [options.concurrency=1] - 消费者的并发数。
     */
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

    /**
     * 动态设置缓冲区的槽位数量。
     * @param {number} n - 新的槽位数量。
     */
    setSlotAmount(n: number): void {
        this.slotAmount = n;
        this.notifyStateChange();
        this.checkWaitingProducers();
    }

    /**
     * 获取当前设置的槽位总数。
     * @returns {number} 当前的槽位数量。
     */
    getSlotAmount(): number {
        return this.slotAmount;
    }

    /**
     * 获取待处理的任务数（缓冲区中等待消费的项目数）。
     * @returns {number} 待处理的任务数。
     */
    getPendingJobs(): number {
        return this.buffer.length;
    }

    /**
     * 获取当前正在执行的任务数。
     * @returns {number} 正在执行的任务数。
     */
    getRunningJobs(): number {
        return this.runningJobs;
    }

    /**
     * 获取当前可用的空闲槽位数量。
     * @returns {number} 空闲槽位的数量。
     */
    getFreeSlotAmount(): number {
        const usedSlots = this.runningJobs + this.buffer.length;
        return Math.max(0, this.slotAmount - usedSlots);
    }

    /**
     * 检查缓冲区是否已满（即生产者是否应被阻塞）。
     * @returns {boolean} 如果缓冲区已满则返回 `true`，否则返回 `false`。
     */
    isBlocked(): boolean {
        return (this.runningJobs + this.buffer.length) >= this.slotAmount;
    }

    /**
     * 等待直到有可用的空闲槽位。这是实现生产者背压的关键。
     * 如果已有空闲槽位，则立即解析。
     * @throws {Error} 如果实例已被销毁。
     * @returns {Promise<boolean>} 一个在有空闲槽位时解析为 `true` 的 Promise。
     */
    async hasFreeSlot(): Promise<boolean> {
        if (this.destroyed) {
            throw new Error('ProdConsPQueue has been destroyed');
        }

        if (!this.isBlocked()) {
            return true;
        }

        return new Promise((resolve) => {
            this.waitingForSlot.push({ resolve: () => resolve(true) });
        });
    }

    /**
     * 等待一个特定的事件被触发。
     * @param {string} eventName - 要等待的事件名称。
     * @param {(value: any) => boolean} [condition] - 一个可选的条件函数。只有当事件值满足该条件时，Promise 才会解析。
     * @throws {Error} 如果实例已被销毁。
     * @returns {Promise<any>} 一个在事件触发且满足条件时，用事件值解析的 Promise。
     */
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

    /**
     * @private
     * 通知并解决等待特定事件的 Promise。
     * @param {string} eventName - 触发的事件名称。
     * @param {any} value - 传递给事件的值。
     */
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

        // 从后往前删除，避免索引错乱
        toRemove.reverse().forEach(index => {
            waiters.splice(index, 1);
        });
    }

    /**
     * @private
     * 在状态（如空闲槽位数、阻塞状态）变化时，发出相应的事件。
     */
    private notifyStateChange(): void {
        if (this.destroyed) return;

        const currentFreeSlots = this.getFreeSlotAmount();
        const currentBlocked = this.isBlocked();

        this.emit('free-slot-amount-change', currentFreeSlots);

        if (currentBlocked !== this.previousBlocked) {
            this.previousBlocked = currentBlocked;
            this.emit('blocked-state-change', currentBlocked);
        }
    }

    /**
     * @private
     * 检查是否有生产者在等待空闲槽位，并在有槽位时唤醒它们。
     */
    private checkWaitingProducers(): void {
        while (this.waitingForSlot.length > 0 && !this.isBlocked()) {
            const waiter = this.waitingForSlot.shift();
            if (waiter) {
                waiter.resolve();
            }
        }
    }

    /**
     * 生产者方法。它会等待一个可用的槽位，然后执行生产函数 `fn`，
     * 并将 `fn` 的返回值添加到缓冲区中。
     * @param {() => Promise<any>} fn - 一个返回 Promise 的生产函数，其解析值将被添加到缓冲区。
     * @throws {Error} 如果实例已被销毁。
     * @returns {Promise<void>} 一个在生产完成并入队后解析的 Promise。
     */
    async produce(fn: () => Promise<any>): Promise<void> {
        if (this.destroyed) {
            throw new Error('ProdConsPQueue has been destroyed');
        }

        await this.hasFreeSlot();

        const data = await fn();
        this.buffer.push(data);

        this.notifyStateChange();
        this.scheduleConsumption();
    }

    /**
     * 设置消费者函数并开始消费过程。
     * @param {(data: any) => Promise<void>} fn - 一个处理单个数据项的异步函数。
     * @throws {Error} 如果实例已被销毁。
     */
    consume(fn: (data: any) => Promise<void>): void {
        if (this.destroyed) {
            throw new Error('ProdConsPQueue has been destroyed');
        }

        this.consumeFn = fn;
        this.consuming = true;
        this.scheduleConsumption();
    }

    /**
     * @private
     * 核心调度逻辑。当缓冲区有数据且 p-queue 有能力处理更多任务时，
     * 从缓冲区取出数据并将其作为任务添加到 p-queue 中。
     */
    private scheduleConsumption(): void {
        if (!this.consuming || this.destroyed || !this.consumeFn) {
            return;
        }

        // 持续调度消费任务，直到缓冲区为空或 p-queue 并发达到上限
        while (this.buffer.length > 0 && this.runningJobs < this.queue.concurrency) {
            const data = this.buffer.shift();
            if (data !== undefined) {
                this.runningJobs++;
                this.notifyStateChange(); // 缓冲区减少，运行任务增加，状态更新

                // 将消费任务添加到 PQueue 中
                this.queue.add(async () => {
                    try {
                        if (this.consumeFn) {
                            await this.consumeFn(data);
                        }
                    } catch (error) {
                        console.error('Error in consumer function:', error);
                    } finally {
                        // 消费完成后清理
                        this.runningJobs--;
                        this.checkWaitingProducers(); // 检查是否有等待的生产者
                        this.notifyStateChange(); // 消费完成，状态更新

                        // 使用 setImmediate 尝试调度更多任务，避免同步递归过深
                        setImmediate(() => this.scheduleConsumption());
                    }
                });
            }
        }
    }

    /**
     * 等待直到缓冲区为空，并且所有当前正在消费的项目都处理完毕。
     * @returns {Promise<void>} 当队列完全变空时解析的 Promise。
     */
    async waitForEmpty(): Promise<void> {
        while ((this.buffer.length > 0 || this.runningJobs > 0) && this.consuming && !this.destroyed) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }
    }

    /**
     * 等待所有已入队和正在进行的消费任务完成。
     * 这比 `waitForEmpty` 更为彻底，因为它确保 p-queue 也变为空闲状态。
     * @returns {Promise<void>} 当所有任务都完成时解析的 Promise。
     */
    async waitForConsumption(): Promise<void> {
        // 等待 p-queue 中的所有任务完成
        await this.queue.onIdle();
        // 再次确认缓冲区和正在消费的项也为空
        await this.waitForEmpty();
    }

    /**
     * 注册一个事件监听器。
     * @param {'free-slot-amount-change' | 'blocked-state-change' | 'destroy'} event - 事件名称。
     * @param {EventListener<any>} callback - 事件触发时执行的回调函数。
     */
    on(event: 'free-slot-amount-change' | 'blocked-state-change' | 'destroy', callback: EventListener<any>): void {
        if (this.destroyed) {
            return;
        }

        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);
    }

    /**
     * 移除一个事件监听器。
     * @param {'free-slot-amount-change' | 'blocked-state-change' | 'destroy'} event - 事件名称。
     * @param {EventListener<any>} callback - 要移除的回调函数。
     */
    off(event: 'free-slot-amount-change' | 'blocked-state-change' | 'destroy', callback: EventListener<any>): void {
        if (this.listeners.has(event)) {
            this.listeners.get(event)!.delete(callback);
        }
    }

    /**
     * @private
     * 触发一个事件，并通知所有相关的监听器和等待者。
     * @param {string} event - 要触发的事件名称。
     * @param {any} value - 传递给监听器的值。
     */
    private emit(event: string, value: any): void {
        if (this.destroyed) {
            return;
        }

        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => callback(value));
        }

        this.notifyEventWaiters(event, value);
    }

    /**
     * 暂停消费。
     * 不会停止已经在执行的任务，但会阻止新的任务从缓冲区进入消费流程。
     * @returns {Promise<void>} 在队列暂停后解析的 Promise。
     */
    async pause(): Promise<void> {
        this.consuming = false;
        await this.queue.pause();
    }

    /**
     * 启动或恢复消费。
     * @returns {Promise<void>}
     */
    async start(): Promise<void> {
        this.consuming = true;
        this.queue.start(); // 确保 p-queue 正在运行
        this.scheduleConsumption(); // 立即尝试调度任务
    }

    /**
     * 清空缓冲区和 p-queue 中所有待处理的任务。
     * 正在执行的任务不受影响。
     * 同时会唤醒所有等待的生产者。
     * @returns {Promise<void>} 在清空操作完成后解析的 Promise。
     */
    async clear(): Promise<void> {
        this.buffer = [];

        // 唤醒所有等待的生产者，因为队列被清空了
        this.waitingForSlot.forEach(waiter => waiter.resolve());
        this.waitingForSlot = [];

        await this.queue.clear();
        this.notifyStateChange(); // 状态发生重大变化，通知监听者
    }

    /**
     * 销毁实例。
     * 这将停止所有活动，清空内部状态，并使实例不可用。
     * @returns {Promise<void>} 在实例完全销毁后解析的 Promise。
     */
    async destroy(): Promise<void> {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.consuming = false;
        this.consumeFn = null;

        // 解决所有等待的 Promise，以防它们永远挂起
        this.waitingForSlot.forEach(waiter => waiter.resolve());
        this.waitingForSlot = [];

        this.eventWaiters.forEach(waiters => {
            waiters.forEach(waiter => waiter.resolve(null)); // 以 null 值解决，表示销毁
        });
        this.eventWaiters.clear();

        await this.queue.pause();
        await this.queue.clear();

        this.emit('destroy', this); // 触发 destroy 事件
        this.listeners.clear();
    }

    /**
     * 获取当前队列的统计信息。
     * @returns {{
     *   pendingJobs: number,
     *   runningJobs: number,
     *   freeSlotAmount: number,
     *   isBlocked: boolean,
     *   isPaused: boolean,
     *   concurrency: number,
     *   slotAmount: number
     * }} 包含队列状态的对象。
     */
    getStats(): {
        pendingJobs: number;
        runningJobs: number;
        freeSlotAmount: number;
        isBlocked: boolean;
        isPaused: boolean;
        concurrency: number;
        slotAmount: number;
    } {
        return {
            /** 待处理的任务数（缓冲区中等待消费的项目数） */
            pendingJobs: this.buffer.length,
            /** 当前正在执行的任务数 */
            runningJobs: this.runningJobs,
            /** 可用的空闲槽位数 */
            freeSlotAmount: this.getFreeSlotAmount(),
            /** 生产者是否被阻塞 (槽位已满) */
            isBlocked: this.isBlocked(),
            /** 队列是否已暂停 */
            isPaused: this.queue.isPaused,
            /** 配置的并发数 */
            concurrency: this.queue.concurrency,
            /** 配置的槽位总数 */
            slotAmount: this.slotAmount
        };
    }
}

export default ProdConsPQueue;
