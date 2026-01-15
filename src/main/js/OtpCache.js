import {Readable} from 'stream';

const OTP_MAX_LIFETIME=20_000;

/**
 * maintain a cache of one time passwords. Each OTP points to an arbitrary
 * piece of data.
 */
class OtpCache {
  #timers={};

  add(otp,data) {
    this[otp]=data;
    this.#timers[otp]=setTimeout(()=>{
      console.warn("OtpCache: deleting key:",otp);
      delete this[otp];
      delete this.#timers[otp];
    },OTP_MAX_LIFETIME);
  }

  has(otp) {
    return Boolean(String(otp) in this);
  }

  /**
   * get the data associated with the OTP, and this also effectively expires it
   *
   * @returns {object}
   */
  get(otp) {
    if (!this.has(otp)) {
      return null;
    }
    const data=this[otp];
    delete this[otp];
    clearTimeout(this.#timers[otp])
    delete this.#timers[otp];
    return data;
  }

  /*
  getStream(otp) {
    const data=this.get(otp);
    return new Readable({
      encoding:'utf8',
      read:function(size) {
        this.push(String(data));
        this.push(null);
      }
    });
  }
  */

  eraseValues() {
    Object.keys(this).forEach(otp=>this[otp]=undefined);
    return Promise.resolve();
  }
}

export default OtpCache;
