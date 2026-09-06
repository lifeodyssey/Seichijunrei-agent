/** Identity-slot copy for the chat chrome: the localized brand, the login
 * entry, the signed-in marker, and the settings deep link. The direction-E
 * shell renders these in the sidebar's user card and the slim mobile top bar
 * rather than a full app bar. */
export interface ChatAppBarDict {
  /** SD-16 brand name: 聖地巡礼 / 圣地巡礼 / Animichi. */
  readonly brand: string;
  readonly signedIn: string;
  readonly login: string;
  readonly settings: string;
}

export const jaAppBar: ChatAppBarDict = {
  brand: "聖地巡礼",
  signedIn: "ログイン中",
  login: "ログイン",
  settings: "設定",
};

export const zhAppBar: ChatAppBarDict = {
  brand: "圣地巡礼",
  signedIn: "已登录",
  login: "登录",
  settings: "设置",
};

export const enAppBar: ChatAppBarDict = {
  brand: "Animichi",
  signedIn: "Signed in",
  login: "Log in",
  settings: "Settings",
};
