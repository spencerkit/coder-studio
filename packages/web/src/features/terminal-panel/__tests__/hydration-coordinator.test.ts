import { describe, expect, it } from 'vitest';
import { createHydrationCoordinator } from '../hydration-coordinator';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('HydrationCoordinator', () => {
  it('grants up to the concurrency limit immediately and queues the rest', async () => {
    const coordinator = createHydrationCoordinator({ concurrency: 2 });

    const first = coordinator.request({ terminalId: 'term-1', tier: 'visible-other' });
    const second = coordinator.request({ terminalId: 'term-2', tier: 'visible-other' });
    const third = coordinator.request({ terminalId: 'term-3', tier: 'visible-other' });

    await flushMicrotasks();

    expect(coordinator.inspect()).toEqual({
      running: ['term-1', 'term-2'],
      queued: [{ terminalId: 'term-3', tier: 'visible-other', queuePosition: 0 }],
    });

    let thirdGranted = false;
    void third.granted.then(() => {
      thirdGranted = true;
    });

    await flushMicrotasks();
    expect(thirdGranted).toBe(false);

    first.release();
    await flushMicrotasks();

    expect(thirdGranted).toBe(true);
    expect(coordinator.inspect()).toEqual({
      running: ['term-2', 'term-3'],
      queued: [],
    });

    second.release();
    third.release();
  });

  it('promotes queued requests without preempting in-flight ones', async () => {
    const coordinator = createHydrationCoordinator({ concurrency: 1 });

    const first = coordinator.request({ terminalId: 'term-1', tier: 'visible-other' });
    const second = coordinator.request({ terminalId: 'term-2', tier: 'background' });
    const third = coordinator.request({ terminalId: 'term-3', tier: 'visible-other' });

    await flushMicrotasks();

    expect(coordinator.inspect()).toEqual({
      running: ['term-1'],
      queued: [
        { terminalId: 'term-3', tier: 'visible-other', queuePosition: 0 },
        { terminalId: 'term-2', tier: 'background', queuePosition: 1 },
      ],
    });

    second.promote('focused');
    await flushMicrotasks();

    expect(coordinator.inspect()).toEqual({
      running: ['term-1'],
      queued: [
        { terminalId: 'term-2', tier: 'focused', queuePosition: 0 },
        { terminalId: 'term-3', tier: 'visible-other', queuePosition: 1 },
      ],
    });

    let secondGranted = false;
    void second.granted.then(() => {
      secondGranted = true;
    });

    await flushMicrotasks();
    expect(secondGranted).toBe(false);

    first.release();
    await flushMicrotasks();

    expect(secondGranted).toBe(true);
    expect(coordinator.inspect()).toEqual({
      running: ['term-2'],
      queued: [{ terminalId: 'term-3', tier: 'visible-other', queuePosition: 0 }],
    });

    second.release();
    third.release();
  });

  it('reuses the same request handle for duplicate terminal ids while queued or running', async () => {
    const coordinator = createHydrationCoordinator({ concurrency: 1 });

    const first = coordinator.request({ terminalId: 'term-1', tier: 'visible-other' });
    const duplicateRunning = coordinator.request({ terminalId: 'term-1', tier: 'focused' });
    const queued = coordinator.request({ terminalId: 'term-2', tier: 'background' });
    const duplicateQueued = coordinator.request({ terminalId: 'term-2', tier: 'focused' });

    await flushMicrotasks();

    expect(duplicateRunning).toBe(first);
    expect(duplicateQueued).toBe(queued);
    expect(coordinator.inspect()).toEqual({
      running: ['term-1'],
      queued: [{ terminalId: 'term-2', tier: 'focused', queuePosition: 0 }],
    });
  });

  it('reports queue position updates and removes queued requests on release', async () => {
    const coordinator = createHydrationCoordinator({ concurrency: 1 });

    const first = coordinator.request({ terminalId: 'term-1', tier: 'visible-other' });
    const second = coordinator.request({ terminalId: 'term-2', tier: 'visible-other' });
    const third = coordinator.request({ terminalId: 'term-3', tier: 'visible-other' });
    const positions: number[] = [];

    const unsubscribe = third.subscribePosition((position) => {
      positions.push(position);
    });

    await flushMicrotasks();
    expect(positions).toEqual([1]);

    second.release();
    await flushMicrotasks();

    expect(coordinator.inspect()).toEqual({
      running: ['term-1'],
      queued: [{ terminalId: 'term-3', tier: 'visible-other', queuePosition: 0 }],
    });
    expect(positions).toEqual([1, 0]);

    unsubscribe();
    third.release();
    await flushMicrotasks();

    expect(coordinator.inspect()).toEqual({
      running: ['term-1'],
      queued: [],
    });

    first.release();
  });
});
