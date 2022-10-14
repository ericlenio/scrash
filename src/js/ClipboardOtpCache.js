import {Readable} from 'stream';

class ClipboardOtpCache {
  #timers={};
  add(otp,content) {
    this[otp]=content;
    this.#timers[otp]=setTimeout(()=>{
      console.warn("ClipboardOtpCache: deleting key:",otp);
      delete this[otp];
      delete this.#timers[otp];
    },20_000);
  }

  get(otp) {
    const content=this[otp];
    delete this[otp];
    clearTimeout(this.#timers[otp])
    delete this.#timers[otp];
    return content;
  }

  getStream(otp) {
    const content=this.get(otp);
    return new Readable({
      encoding:'utf8',
      read:function(size) {
        this.push(String(content));
        this.push(null);
      }
    });
  }
}

export default ClipboardOtpCache;
