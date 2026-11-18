declare module "*.css";

declare module "@novnc/novnc" {
  export default class RFB {
    constructor(target: HTMLElement, url: string);
    scaleViewport: boolean;
    focusOnClick: boolean;
    disconnect(): void;
  }
}
