import ProdConsPQueue from '../src/index.js';

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
console.log('开始生产数据...');
for (let i = 0; i < 15; i++) {
  prodCons.produce(async () => {
    console.log(`生产数据 ${i}`);
    await new Promise(resolve => setTimeout(resolve, 50));
    return `item-${i}`;
  });
}

// 等待所有数据处理完成
setTimeout(async () => {
  console.log('最终状态:', prodCons.getStats());
  await prodCons.destroy();
  console.log('示例完成');
}, 5000);