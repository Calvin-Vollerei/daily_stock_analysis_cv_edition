import apiClient from './index';
import { toCamelCase } from './utils';

export interface AboutAuthorItem {
  role: string;
  name: string;
  url?: string | null;
  note?: string | null;
}

export interface AboutResponse {
  version: string;
  versionSource: string;
  repo: string;
  repoUrl: string;
  upstreamRepo: string;
  upstreamUrl: string;
  license: string;
  authors: AboutAuthorItem[];
}

export interface UpdateCheckResponse {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url?: string | null;
  name?: string | null;
  publishedAt?: string | null;
  repo: string;
  error?: string | null;
}

/** 关于页用到的两个只读接口：版本信息与更新检查。 */
export const systemAboutApi = {
  async getAbout(): Promise<AboutResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/system/about');
    return toCamelCase<AboutResponse>(response.data);
  },

  async checkUpdate(): Promise<UpdateCheckResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/system/update-check');
    return toCamelCase<UpdateCheckResponse>(response.data);
  },
};
