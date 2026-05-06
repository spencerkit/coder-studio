const STREAM_TOPIC_RE = /^workspace\.[^.]+\.terminal\.[^.]+\.output$/;

export function isStreamTopic(topic: string): boolean {
  return STREAM_TOPIC_RE.test(topic);
}
