// Il pacchetto @novnc/novnc è JavaScript puro e i tipi su DefinitelyTyped sono
// fermi alla 1.6: qui si dichiara solo la superficie che il viewer usa.
declare module "@novnc/novnc" {
  export interface RfbOptions {
    credentials?: { password?: string };
    shared?: boolean;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RfbOptions);
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    disconnect(): void;
  }
}
