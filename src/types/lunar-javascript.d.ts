/**
 * lunar-javascript 是纯 JS 包,不自带类型声明。
 * 这里只声明本项目实际用到的最小面:
 *   小六壬面板取「今天的农历月日」作表单默认值,并按当前农历年校验日的上限;
 *   「今日运势」的页脚要一行农历日期(二〇二六年八月二十),所以还要年/月/日的中文写法。
 * 保持为脚本级环境声明(文件内不出现 import/export),避免变成模块增强。
 */
declare module "lunar-javascript" {
  export interface LunarDate {
    /** 农历年。 */
    getYear(): number;
    /** 农历月 1–12;闰月返回负值(该库的约定),调用方按需取绝对值。 */
    getMonth(): number;
    /** 农历日 1–30。 */
    getDay(): number;
    /** 二〇二六 */
    getYearInChinese(): string;
    /** 八 */
    getMonthInChinese(): string;
    getDayInChinese(): string;
  }

  export interface SolarDate {
    getLunar(): LunarDate;
    toYmd(): string;
  }

  export interface LunarMonthDate {
    getYear(): number;
    /** 该库用负数表示闰月。 */
    getMonth(): number;
    /** 该月天数(29 或 30)。 */
    getDayCount(): number;
  }

  export const Solar: {
    fromDate(date: Date): SolarDate;
    fromYmd(year: number, month: number, day: number): SolarDate;
  };

  export const LunarMonth: {
    /** 取某农历年的某月;月份不存在时返回 null(不抛错)。 */
    fromYm(lunarYear: number, lunarMonth: number): LunarMonthDate | null;
  };
}
