import {Readable} from 'stream';

class Otp extends Readable {
  #otp;
  constructor(otp) {
    super({encoding:'utf8'});
    this.#otp=otp;
  }

  _read(size) {
    this.push(String(this.#otp));
    this.push(null);
  }
}

export default Otp;
