import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ProdConsPQueue from './index';

describe('ProdConsPQueue', () => {
  let prodCons: ProdConsPQueue;

  beforeEach(() => {
    prodCons = new ProdConsPQueue({ slotAmount: 5, concurrency: 2 });
  });

  afterEach(async () => {
    await prodCons.destroy();
  });

  describe('基础功能测试', () => {
    it('应该初始化正确的状态', () => {
      expect(prodCons.getSlotAmount()).toBe(5);
      expect(prodCons.getBufferLength()).toBe(0);
      expect(prodCons.getFreeSlotAmount()).toBe(5);
      expect(prodCons.isBlocked()).toBe(false);
    });

    it('应该能够设置槽位数量', () => {
      prodCons.setSlotAmount(10);
      expect(prodCons.getSlotAmount()).toBe(10);
      expect(prodCons.getFreeSlotAmount()).toBe(10);
    });

    it('应该正确计算可用槽位', async () => {
      await prodCons.produce(async () => 'data1');
      await prodCons.produce(async () => 'data2');
      
      expect(prodCons.getBufferLength()).toBe(2);
      expect(prodCons.getFreeSlotAmount()).toBe(3);
      expect(prodCons.isBlocked()).toBe(false);
    });

    it('在缓冲区满时应该被阻塞', async () => {
      // 填满缓冲区
      for (let i = 0; i < 5; i++) {
        await prodCons.produce(async () => `data${i}`);
      }
      
      expect(prodCons.getBufferLength()).toBe(5);
      expect(prodCons.getFreeSlotAmount()).toBe(0);
      expect(prodCons.isBlocked()).toBe(true);
    });
  });

  describe('hasFreeSlot测试', () => {
    it('在有空闲槽位时应该立即返回', async () => {
      await prodCons.produce(async () => 'data1');
      
      const start = Date.now();
      await prodCons.hasFreeSlot();
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(10);
      expect(prodCons.getFreeSlotAmount()).toBe(4);
    });

    it('在缓冲区满时应该等待', async () => {
      // 填满缓冲区
      for (let i = 0; i < 5; i++) {
        await prodCons.produce(async () => `data${i}`);
      }
      
      expect(prodCons.isBlocked()).toBe(true);
      
      // 设置消费函数
      let consumedCount = 0;
      prodCons.consume(async (data) => {
        consumedCount++;
        await new Promise(resolve => setTimeout(resolve, 1));
      });
      
      // hasFreeSlot 应该等待到有槽位可用
      const start = Date.now();
      await prodCons.hasFreeSlot();
      const duration = Date.now() - start;
      
      // 应该需要等待一些时间
      expect(duration).toBeGreaterThan(0);
      expect(consumedCount).toBeGreaterThan(0);
      expect(prodCons.getFreeSlotAmount()).toBe(1);
    });
  });

  describe('produce和consume测试', () => {
    it('应该正确生产和消费数据', async () => {
      const consumedData: any[] = [];

      // 设置消费函数
      prodCons.consume(async (data) => {
        consumedData.push(data);
        await new Promise(resolve => setTimeout(resolve, 1));
      });

      // 生产数据
      for (let i = 0; i < 3; i++) {
        await prodCons.produce(async () => `item${i}`);
      }

      // 等待所有数据被消费完
      await prodCons.waitForEmpty();

      expect(consumedData).toEqual(['item0', 'item1', 'item2']);
      expect(prodCons.getBufferLength()).toBe(0);
    });

    it('应该正确处理错误', async () => { 
      let processedCount = 0;

      // 填满缓冲区
      for (let i = 0; i < 5; i++) {
        await prodCons.produce(async () => `data${i}`);
      }

      // 消费时对特定数据抛出错误
      prodCons.consume(async (data) => {
        processedCount++;
        if (data === 'data2') {
          throw new Error('消费错误');
        }
        await new Promise(resolve => setTimeout(resolve, 1));
      });

      // 等待处理完成
      await prodCons.waitForEmpty();

      // 应该处理了5个数据（包括出错的），缓冲区应该被清空
      expect(processedCount).toBe(5);
      expect(prodCons.getBufferLength()).toBe(0);
    });
  });

  describe('事件测试', () => {
    it('应该触发空闲槽位变化事件', async () => {
      const events: any[] = [];
      
      prodCons.on('free-slot-amount-change', (value) => {
        events.push({ type: 'free-slot-amount-change', value });
      });

      await prodCons.produce(async () => 'data1');
      
      expect(events).toEqual([{ type: 'free-slot-amount-change', value: 4 }]);

      await prodCons.produce(async () => 'data2');
      
      expect(events).toEqual([
        { type: 'free-slot-amount-change', value: 4 },
        { type: 'free-slot-amount-change', value: 3 }
      ]);
    });

    it('应该触发阻塞状态变化事件', async () => {
      const events: any[] = [];
      
      prodCons.on('blocked-state-change', (value) => {
        events.push({ type: 'blocked-state-change', value });
      });

      // 填满缓冲区，应该触发阻塞事件
      for (let i = 0; i < 5; i++) {
        await prodCons.produce(async () => `data${i}`);
      }
      
      expect(events).toEqual([{ type: 'blocked-state-change', value: true }]);

      // 设置消费函数
      prodCons.consume(async (data) => {
        await new Promise(resolve => setTimeout(resolve, 1));
      });

      // 等待阻塞状态变为false的事件
      await prodCons.waitForEvent('blocked-state-change', (value) => value === false);

      expect(events).toEqual([
        { type: 'blocked-state-change', value: true },
        { type: 'blocked-state-change', value: false }
      ]);
    });
  });

  describe('控制功能测试', () => {
    it('应该能够暂停和继续', async () => {
      let consumeCallCount = 0;
      
      prodCons.consume(async (data) => {
        consumeCallCount++;
        await new Promise(resolve => setTimeout(resolve, 5));
      });

      // 生产数据并等待消费
      await prodCons.produce(async () => 'data1');
      await prodCons.produce(async () => 'data2');

      // 等待消费开始
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 此时应该已经消费了一些数据
      const consumedBeforePause = consumeCallCount;
      expect(consumedBeforePause).toBeGreaterThan(0);

      await prodCons.pause();
      
      await prodCons.produce(async () => 'data3');
      await prodCons.produce(async () => 'data4');

      // 暂停后等待一段时间，消费次数不应该增加
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(consumeCallCount).toBe(consumedBeforePause);

      await prodCons.start();
      
      // 继续后等待消费完成
      await prodCons.waitForEmpty();
      expect(consumeCallCount).toBe(4);
    });

    it('应该能够清空缓冲区', async () => {
      await prodCons.produce(async () => 'data1');
      await prodCons.produce(async () => 'data2');

      expect(prodCons.getBufferLength()).toBe(2);
      expect(prodCons.getFreeSlotAmount()).toBe(3);

      await prodCons.clear();

      expect(prodCons.getBufferLength()).toBe(0);
      expect(prodCons.getFreeSlotAmount()).toBe(5);
    });
  });

  describe('销毁测试', () => {
    it('应该正确销毁实例', async () => {
      let destroyCalled = false;
      
      prodCons.on('destroy', () => {
        destroyCalled = true;
      });

      await prodCons.produce(async () => 'data1');
      prodCons.consume(async (data) => {
        await new Promise(resolve => setTimeout(resolve, 1));
      });

      await prodCons.destroy();

      expect(destroyCalled).toBe(true);
      expect(prodCons.getBufferLength()).toBe(0);
    });

    it('销毁后应该抛出错误', async () => {
      await prodCons.destroy();

      await expect(prodCons.produce(async () => 'data1')).rejects.toThrow('ProdConsPQueue has been destroyed');
      await expect(prodCons.hasFreeSlot()).rejects.toThrow('ProdConsPQueue has been destroyed');
    });
  });

  describe('统计信息测试', () => {
    it('应该返回正确的统计信息', async () => {
      // 填满缓冲区
      for (let i = 0; i < 3; i++) {
        await prodCons.produce(async () => `data${i}`);
      }

      const stats = prodCons.getStats();

      expect(stats.bufferLength).toBe(3);
      expect(stats.freeSlotAmount).toBe(2);
      expect(stats.isBlocked).toBe(false);
      expect(stats.pendingJobs).toBe(0);
      expect(stats.isPaused).toBe(false);
    });
  });

  describe('并发测试', () => {
    it('应该正确处理并发生产和消费', async () => {
      const producedCount = 10;
      const results: any[] = [];

      // 设置消费函数
      prodCons.consume(async (data) => {
        results.push(data);
        // 模拟处理时间
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2));
      });

      // 并发生产
      const productionPromises = Array.from({ length: producedCount }, (_, i) =>
        prodCons.produce(async () => `item${i}`)
      );

      await Promise.all(productionPromises);
      
      // 等待所有数据被消费完
      await prodCons.waitForEmpty();

      expect(results.length).toBe(producedCount);
      expect(results).toEqual(expect.arrayContaining([
        'item0', 'item1', 'item2', 'item3', 'item4', 
        'item5', 'item6', 'item7', 'item8', 'item9'
      ]));
      expect(prodCons.getBufferLength()).toBe(0);
    });
  });

  describe('新增功能测试', () => {
    it('waitForEmpty应该等待缓冲区清空', async () => {
      let consumeCount = 0;
      
      prodCons.consume(async (data) => {
        consumeCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      // 生产一些数据
      await prodCons.produce(async () => 'data1');
      await prodCons.produce(async () => 'data2');
      await prodCons.produce(async () => 'data3');

      expect(prodCons.getBufferLength()).toBe(3);

      // 等待清空
      await prodCons.waitForEmpty();

      expect(prodCons.getBufferLength()).toBe(0);
      expect(consumeCount).toBe(3);
    });

    it('waitForConsumption应该等待当前消费完成', async () => {
      let isConsuming = false;
      let consumeFinished = false;

      prodCons.consume(async (data) => {
        isConsuming = true;
        await new Promise(resolve => setTimeout(resolve, 20));
        consumeFinished = true;
        isConsuming = false;
      });

      await prodCons.produce(async () => 'data1');

      // 等待消费开始
      while (!isConsuming) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      expect(consumeFinished).toBe(false);

      await prodCons.waitForConsumption();

      expect(consumeFinished).toBe(true);
      expect(prodCons.getBufferLength()).toBe(0);
    });

    it('waitForEvent应该等待特定事件', async () => {
      let eventReceived = false;
      let eventValue: any = null;

      // 启动等待事件的异步操作
      const eventPromise = prodCons.waitForEvent('blocked-state-change', (value) => value === true);
      eventPromise.then((value) => {
        eventReceived = true;
        eventValue = value;
      });

      // 触发事件
      for (let i = 0; i < 5; i++) {
        await prodCons.produce(async () => `data${i}`);
      }

      await eventPromise;

      expect(eventReceived).toBe(true);
      expect(eventValue).toBe(true);
    });

    it('waitForEvent应该支持条件过滤', async () => {
      const events: number[] = [];

      // 监听所有 free-slot-amount-change 事件
      prodCons.on('free-slot-amount-change', (value) => {
        events.push(value);
      });

      // 等待 free-slot-amount-change 值为 2 的事件
      const eventPromise = prodCons.waitForEvent('free-slot-amount-change', (value) => value === 2);

      // 生产数据，触发多个事件
      await prodCons.produce(async () => 'data1'); // free-slot: 4
      await prodCons.produce(async () => 'data2'); // free-slot: 3
      await prodCons.produce(async () => 'data3'); // free-slot: 2

      const eventValue = await eventPromise;

      expect(eventValue).toBe(2);
      expect(events).toEqual([4, 3, 2]);
    });
  });
});