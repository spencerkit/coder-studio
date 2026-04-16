import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupervisorScheduler } from './scheduler.js';

describe('SupervisorScheduler', () => {
  let scheduler: SupervisorScheduler;
  let onTick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onTick = vi.fn();
    scheduler = new SupervisorScheduler(onTick);
  });

  afterEach(() => {
    scheduler.stopAll();
    vi.useRealTimers();
  });

  it('calls onTick at the specified interval', () => {
    scheduler.start('sup-1', 1000);
    expect(onTick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledWith('sup-1');
    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('stops a specific schedule', () => {
    scheduler.start('sup-1', 1000);
    scheduler.stop('sup-1');

    vi.advanceTimersByTime(5000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('stops all schedules', () => {
    scheduler.start('sup-1', 1000);
    scheduler.start('sup-2', 2000);
    scheduler.stopAll();

    vi.advanceTimersByTime(5000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('does not duplicate schedules for the same supervisor', () => {
    scheduler.start('sup-1', 1000);
    scheduler.start('sup-1', 1000);

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });
});