type RequestState<T> = {
  result: T;
  error: DOMException | null;
  onsuccess: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onupgradeneeded?: ((event: Event) => unknown) | null;
};

type TransactionState = {
  error: DOMException | null;
  oncomplete: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
};

export class FakeIndexedDb {
  readonly factory: IDBFactory;
  readonly records = new Map<IDBValidKey, unknown>();
  failNextOpen = false;
  failNextRead = false;
  failNextWrite = false;
  delayNextRead = false;
  private hasStore = false;

  constructor() {
    this.factory = {
      open: () => this.open()
    } as unknown as IDBFactory;
  }

  private open(): IDBOpenDBRequest {
    const database = this.database();
    const request: RequestState<IDBDatabase> = {
      result: database,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null
    };
    queueMicrotask(() => {
      if (this.failNextOpen) {
        this.failNextOpen = false;
        request.error = new DOMException("Simulated IndexedDB open failure", "UnknownError");
        request.onerror?.(new Event("error"));
        return;
      }
      if (!this.hasStore) request.onupgradeneeded?.(new Event("upgradeneeded"));
      request.onsuccess?.(new Event("success"));
    });
    return request as unknown as IDBOpenDBRequest;
  }

  private database(): IDBDatabase {
    return {
      objectStoreNames: {
        contains: () => this.hasStore
      },
      createObjectStore: () => {
        this.hasStore = true;
        return {} as IDBObjectStore;
      },
      transaction: () => this.transaction(),
      close: () => undefined
    } as unknown as IDBDatabase;
  }

  private transaction(): IDBTransaction {
    const transaction: TransactionState = {
      error: null,
      oncomplete: null,
      onerror: null
    };
    const fail = () => {
      this.failNextWrite = false;
      transaction.error = new DOMException("Simulated IndexedDB write failure", "UnknownError");
      transaction.onerror?.(new Event("error"));
    };
    const objectStore = {
      pendingWrites: [] as Array<[IDBValidKey, unknown]>,
      get: (key: IDBValidKey) => {
        const request: RequestState<unknown> = {
          result: undefined,
          error: null,
          onsuccess: null,
          onerror: null
        };
        const complete = () => {
          if (this.failNextRead) {
            this.failNextRead = false;
            request.error = new DOMException("Simulated IndexedDB read failure", "UnknownError");
            request.onerror?.(new Event("error"));
            return;
          }
          request.result = this.records.get(key);
          request.onsuccess?.(new Event("success"));
        };
        if (this.delayNextRead) {
          this.delayNextRead = false;
          queueMicrotask(() => queueMicrotask(complete));
        } else queueMicrotask(complete);
        return request as unknown as IDBRequest;
      },
      put: (value: unknown, key: IDBValidKey) => {
        objectStore.pendingWrites.push([key, value]);
        queueMicrotask(() => {
          if (this.failNextWrite) {
            objectStore.pendingWrites.length = 0;
            fail();
            return;
          }
          if (objectStore.pendingWrites.at(-1)?.[0] !== key) return;
          objectStore.pendingWrites.forEach(([writeKey, writeValue]) => this.records.set(writeKey, writeValue));
          objectStore.pendingWrites.length = 0;
          transaction.oncomplete?.(new Event("complete"));
        });
        return {} as IDBRequest;
      },
      delete: (key: IDBValidKey) => {
        queueMicrotask(() => {
          if (this.failNextWrite) {
            fail();
            return;
          }
          this.records.delete(key);
          transaction.oncomplete?.(new Event("complete"));
        });
        return {} as IDBRequest;
      }
    };
    return {
      objectStore: () => objectStore,
      get error() {
        return transaction.error;
      },
      get oncomplete() {
        return transaction.oncomplete;
      },
      set oncomplete(handler) {
        transaction.oncomplete = handler as ((event: Event) => unknown) | null;
      },
      get onerror() {
        return transaction.onerror;
      },
      set onerror(handler) {
        transaction.onerror = handler as ((event: Event) => unknown) | null;
      }
    } as unknown as IDBTransaction;
  }
}
