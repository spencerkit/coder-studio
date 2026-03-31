export const createHistoryRefreshController = <T,>(
  load: () => Promise<T | null>,
) => {
  let inflight: Promise<T | null> | null = null;
  let replayAfterInflight: Promise<T | null> | null = null;
  let lastResult: T | null = null;
  let loaded = false;
  let dirty = false;

  const startLoad = () => {
    if (inflight) {
      return inflight;
    }

    inflight = load()
      .then((result) => {
        if (result !== null) {
          lastResult = result;
          loaded = true;
          dirty = false;
        }
        return result;
      })
      .finally(() => {
        inflight = null;
      });

    return inflight;
  };

  const request = (force = false): Promise<T | null> => {
    if (replayAfterInflight) {
      return replayAfterInflight;
    }

    if (!force && loaded && !dirty) {
      return Promise.resolve(lastResult);
    }

    if (inflight) {
      if (!force) {
        return inflight;
      }
      replayAfterInflight = inflight.then(() => {
        replayAfterInflight = null;
        dirty = true;
        return startLoad();
      });
      return replayAfterInflight;
    }

    if (force) {
      dirty = true;
    }
    return startLoad();
  };

  return {
    request,
    markDirty() {
      dirty = true;
    },
    hasLoaded() {
      return loaded;
    },
  };
};
