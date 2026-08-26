/**
 * API 聚合出口。业务代码统一 `import api from '../net/api'`，
 * 用 api.pet.feed() 这种带模块名的方式调用，避免同名函数打架。
 */

import { get } from '../request';
import * as pet from './pet';
import * as wallet from './wallet';
import * as daily from './daily';
import * as race from './race';
import * as ad from './ad';
import * as wardrobe from './wardrobe';
import * as items from './items';
import * as home from './home';
import * as dex from './dex';
import * as gacha from './gacha';
import * as exchange from './exchange';
import * as address from './address';
import * as promo from './promo';
import type { HealthView } from '../types';

/** 健康检查，免鉴权 */
const health = (): Promise<HealthView> => get('/health', null, { auth: false, retry: false });

export { pet, wallet, daily, race, ad, wardrobe, items, home, dex, gacha, exchange, address, promo, health };

export default {
  health,
  pet,
  wallet,
  daily,
  race,
  ad,
  wardrobe,
  items,
  home,
  dex,
  gacha,
  exchange,
  address,
  promo,
};
