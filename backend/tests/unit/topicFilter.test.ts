import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOCKED_TOPICS } from '@shared/constants';
import { matchBlockedTopic, parseBlockedTopics } from '../../src/modules/crawl/topicFilter';

describe('选题黑名单（§3.2 可调）', () => {
  const rules = parseBlockedTopics(DEFAULT_BLOCKED_TOPICS);

  it('默认 11 类，每行一类', () => {
    expect(rules).toHaveLength(11);
  });

  it('命中企业选题', () => {
    expect(matchBlockedTopic('某公司发布财报，股价大涨', rules)).toBe('企业');
  });

  it('命中医疗医院选题', () => {
    expect(matchBlockedTopic('这家医院挂号要排三小时', rules)).toBe('医院');
  });

  it('命中乌克兰战争选题', () => {
    expect(matchBlockedTopic('俄乌战场最新进展', rules)).toBe('乌克兰');
  });

  it('命中魏德尔政治选题', () => {
    expect(matchBlockedTopic('魏德尔再度发声', rules)).toBe('魏德尔');
  });

  it('命中台海选题', () => {
    expect(matchBlockedTopic('台海局势引发关注', rules)).toBe('台湾');
  });

  it('命中负能量恐吓内容', () => {
    expect(matchBlockedTopic('现场画面血腥，令人惊悚', rules)).toBe('恐吓');
  });

  it('命中疫情字样', () => {
    expect(matchBlockedTopic('新冠疫情期间就诊流程', rules)).toBe('新冠');
  });

  it('命中留学生题材（2026-10-20 实测漏网：莫大留学生披旭日旗）', () => {
    expect(
      matchBlockedTopic('莫大留学生课堂披旭日旗这件事，看完我总结了 5 个可以和 5 个不可以', rules),
    ).toBe('旭日旗');
    expect(matchBlockedTopic('出国留学前要想清楚的几件事', rules)).toBe('留学');
  });

  it('命中钧正平等官方军事时评话题（标题里没有"政治"二字也要拦）', () => {
    expect(matchBlockedTopic('钧正平就中国留学生身披旭日旗发声', rules)).toBe('政治');
  });

  it('命中官方媒体字样', () => {
    expect(matchBlockedTopic('央视报道了这场发布会', rules)).toBe('政治');
  });

  it('普通内容不拦', () => {
    expect(matchBlockedTopic('今天天气不错，适合出门散步看展', rules)).toBeNull();
  });

  it('清空配置后不再过滤（可配置出口）', () => {
    expect(matchBlockedTopic('战争题材内容', parseBlockedTopics(''))).toBeNull();
  });

  it('大小写不敏感', () => {
    expect(matchBlockedTopic('COVID 与新冠相关', rules)).toBe('新冠');
  });
});
