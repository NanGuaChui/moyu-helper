/**
 * 全局类型声明文件
 *
 * 功能说明：
 * - 油猴脚本 API 类型声明
 * - unsafeWindow 类型声明
 * - 第三方库类型声明（pako）
 */

// 游戏资源类型定义
interface GameResourceItem {
  id?: string;
  name?: string;
  description?: string;
  icon?: string;
  category?: string[];
  equipPart?: string;
  equipmentType?: string[];
  onEquip?: Array<{
    name?: string;
    statusEffect?: Array<{
      status: string;
      increase?: number;
      decrease?: number;
    }>;
    actionDurationEffect?: Array<{
      action: string;
      increase?: number;
      decrease?: number;
    }>;
  }>;
  rewardEnhanceExp?: number;
  [key: string]: any;
}

type GameResourceCollection = Record<string, GameResourceItem>;

// 油猴脚本全局类型声明
declare const unsafeWindow: Window &
  typeof globalThis & {
    tAllGameResource: GameResourceCollection;
    getResourceKey: (name: string) => string | undefined;
    getResourceDetail: (key: string) => GameResourceItem | null;
  };

// 油猴 API 类型声明
declare const GM: {
  getValue<T>(key: string, defaultValue?: T): Promise<T>;
  setValue(key: string, value: any): Promise<void>;
  listValues(): Promise<string[]>;
  deleteValue(key: string): Promise<void>;
  getResourceText(name: string): Promise<string>;
  addStyle(css: string): Promise<void>;
  info: {
    script: {
      version: string;
      name: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
};



// Vite 环境变量类型声明
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
