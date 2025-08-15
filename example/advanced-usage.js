import ProdConsPQueue from '../src/index.js';

const prodCons = new ProdConsPQueue({ 
  slotAmount: 5,
  concurrency: 3 
});

console.log('=== 高级用法示例 ===\n');

// 动态调整槽位数量
console.log('初始槽位数:', prodCons.getSlotAmount());
prodCons.setSlotAmount(20);
console.log('调整后槽位数:', prodCons.getSlotAmount());

// 获取当前状态
console.log('\n初始状态:', prodCons.getStats());

// 批量生产数据
console.log('\n开始批量生产数据...');
const batchProduce = async () => {
  for (let i = 0; i < 10; i++) {
    await prodCons.produce(async () => {
      console.log(`生产任务 ${i}`);
      // 模拟异步操作
      await new Promise(resolve => setTimeout(resolve, 100));
      return { id: i, data: `data-${i}` };
    });
    console.log('当前状态:', prodCons.getStats());
  }
};

// 批量消费数据
console.log('\n开始批量消费数据...');
const batchConsume = () => {
  prodCons.consume(async (item) => {
    console.log(`消费任务:`, item);
    // 模拟异步处理
    await new Promise(resolve => setTimeout(resolve, 200));
  });
};

// 启动生产者和消费者
batchConsume();
batchProduce();

// 演示控制功能
setTimeout(async () => {
  console.log('\n=== 演示控制功能 ===');
  
  console.log('当前状态:', prodCons.getStats());
  console.log('暂停消费...');
  await prodCons.pause();
  
  // 再生产一些数据
  for (let i = 10; i < 15; i++) {
    await prodCons.produce(async () => ({
      id: i,
      data: `paused-data-${i}`
    }));
  }
  
  console.log('暂停后状态:', prodCons.getStats());
  console.log('继续消费...');
  await prodCons.start();
  
  // 等待处理完成
  setTimeout(async () => {
    console.log('最终状态:', prodCons.getStats());
    
    console.log('清空缓冲区...');
    await prodCons.clear();
    console.log('清空后状态:', prodCons.getStats());
    
    await prodCons.destroy();
    console.log('示例完成');
  }, 3000);
}, 3000);