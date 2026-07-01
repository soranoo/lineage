class Calculator {
  private current: number;

  constructor(start: number) {
    this.current = start;
  }

  private inc(value: number): number {
    this.current += value;
    return this.current;
  }

  add(value: number): number {
    return this.inc(value);
  }
}

const calculator = new Calculator(1);

export const classResult = calculator.add(2);