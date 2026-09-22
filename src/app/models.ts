export interface Room {
  key: string;
  name: string;
}

export interface Connection {
  from: string;
  to: string;
  isLabelled: boolean;
  description: string;
}