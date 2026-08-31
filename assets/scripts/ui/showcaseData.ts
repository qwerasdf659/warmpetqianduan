/**
 * 展示/验证用的本地模拟数据。
 *
 * 这些内容真实产品里应由后端下发（顾客到访、装修目录随等级解锁等），
 * 这里先在客户端造一份假数据，让「顾客系统 / 装修」能在没有对应后端接口时也跑起来。
 * 正式接后端时，把这里换成 net/api 的返回即可，界面层不用动。
 *
 * 装修目录（墙纸/地板）不在这里列——那批贴块直接用 resources.loadDir 扫目录得到，
 * 目录本身就是「可选项清单」，省得手写一长串文件名。
 */

/** 一位到访顾客（模拟）：名字 + 点单 + 耐心（秒） */
export interface MockCustomer {
  name: string;
  order: string;
  patience: number;
}

const CUSTOMER_NAMES = ['球球', '花卷', '奶糖', '煤球', '橘座', '布丁', '年糕', '汤圆', '芝麻', '可乐'];
const CUSTOMER_ORDERS = ['一杯猫薄荷茶', '三文鱼小食', '烤鱼干拼盘', '暖阳晒背位', '毛线球一颗', '罐罐一份'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 随机造一位顾客（模拟后端的「顾客到访」事件） */
export function randomCustomer(): MockCustomer {
  return {
    name: pick(CUSTOMER_NAMES),
    order: pick(CUSTOMER_ORDERS),
    patience: 20 + Math.floor(Math.random() * 40),
  };
}
