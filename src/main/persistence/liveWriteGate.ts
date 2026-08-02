export interface LiveWriteGate {
  assertWritable(): void;
}

export class StorageWriteGate implements LiveWriteGate {
  constructor(private readonly isWritable: () => boolean) {}

  assertWritable(): void {
    if (!this.isWritable()) {
      throw new Error("移动硬盘已断开，无法执行会修改本地状态的操作。");
    }
  }
}

export const allowWrites: LiveWriteGate = {
  assertWritable: () => {},
};
