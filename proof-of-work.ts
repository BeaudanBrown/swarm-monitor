import crypto from 'crypto';
import JSBI from 'jsbi';
import ByteBuffer from 'bytebuffer';

const NONCE_LEN = 8;
// Modify this value for difficulty scaling

export const pow = {
  // Increment Uint8Array nonce by '_increment' with carrying
  incrementNonce(nonce: Iterable<number> | Uint8Array, _increment = 1) {
    let idx = NONCE_LEN - 1;
    const newNonce = new Uint8Array(nonce);
    let increment = _increment;
    do {
      const sum = newNonce[idx] + increment;
      newNonce[idx] = sum % 256;
      increment = Math.floor(sum / 256);
      idx -= 1;
    } while (increment > 0 && idx >= 0);
    return newNonce;
  },

  // Convert a Uint8Array to a base64 string
  bufferToBase64(buf: Uint8Array) {
    function mapFn(ch: number) {
      return String.fromCharCode(ch);
    }
    const binaryString = Array.prototype.map.call(buf, mapFn).join('');
    return ByteBuffer.btoa(binaryString);
  },

  // Convert BigInteger to Uint8Array of length NONCE_LEN
  bigIntToUint8Array(bigInt: JSBI) {
    const arr = new Uint8Array(NONCE_LEN);
    let n;
    for (let idx = NONCE_LEN - 1; idx >= 0; idx -= 1) {
      n = NONCE_LEN - (idx + 1);
      // 256 ** n is the value of one bit in arr[idx], modulus to carry over
      // (bigInt / 256**n) % 256;
      const denominator = JSBI.exponentiate(JSBI.BigInt('256'), JSBI.BigInt(n));
      const fraction = JSBI.divide(bigInt, denominator);
      const uint8Val = JSBI.remainder(fraction, JSBI.BigInt(256));
      arr[idx] = JSBI.toNumber(uint8Val);
    }
    return arr;
  },

  // Compare two Uint8Arrays, return true if arr1 is > arr2
  greaterThan(arr1: Uint8Array, arr2: Uint8Array) {
    // Early exit if lengths are not equal. Should never happen
    if (arr1.length !== arr2.length) return false;

    for (let i = 0, len = arr1.length; i < len; i += 1) {
      if (arr1[i] > arr2[i]) return true;
      if (arr1[i] < arr2[i]) return false;
    }
    return false;
  },

  // Return nonce that hashes together with payload lower than the target
  calcPoW(
    timestamp: number,
    ttl: number,
    pubKey: string,
    data: string,
    difficulty: number,
    increment = 1,
    startNonce = 0
  ) {
    const payload = new Uint8Array(
      ByteBuffer.wrap(
        timestamp.toString() + ttl.toString() + pubKey + data,
        'binary'
      ).toArrayBuffer()
    );

    const target = pow.calcTarget(ttl, payload.length, difficulty);

    let nonce = new Uint8Array(NONCE_LEN);
    nonce = pow.incrementNonce(nonce, startNonce); // initial value
    let trialValue = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);
    let hash = crypto.createHash('sha512');
    hash.update(payload);
    const initialHash = hash.digest();
    const innerPayload = new Uint8Array(initialHash.length + NONCE_LEN);
    innerPayload.set(initialHash, NONCE_LEN);
    let nextNonce = nonce;
    let finalHash: string;
    while (pow.greaterThan(trialValue, target)) {
      nonce = nextNonce;
      nextNonce = pow.incrementNonce(nonce, increment);
      innerPayload.set(nonce);
      hash = crypto.createHash('sha512');
      hash.update(innerPayload);
      const buf = hash.digest();
      finalHash = buf.toString('hex');
      trialValue = buf.slice(0, NONCE_LEN);
    }
    const result: [string, string] = [pow.bufferToBase64(nonce), finalHash];
    return result;
  },

  calcTarget(ttl: number, payloadLen: number, difficulty: number) {
    // payloadLength + NONCE_LEN
    const totalLen = JSBI.add(JSBI.BigInt(payloadLen), JSBI.BigInt(NONCE_LEN));
    // ttl converted to seconds
    const ttlSeconds = JSBI.divide(JSBI.BigInt(ttl), JSBI.BigInt(1000));
    // ttl * totalLen
    const ttlMult = JSBI.multiply(ttlSeconds, JSBI.BigInt(totalLen));
    // 2^16 - 1
    const two16 = JSBI.subtract(
      JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(16)), // 2^16
      JSBI.BigInt(1)
    );
    // ttlMult / two16
    const innerFrac = JSBI.divide(ttlMult, two16);
    // totalLen + innerFrac
    const lenPlusInnerFrac = JSBI.add(totalLen, innerFrac);
    // difficulty * lenPlusInnerFrac
    const denominator = JSBI.multiply(
      JSBI.BigInt(difficulty),
      lenPlusInnerFrac
    );
    // 2^64 - 1
    const two64 = JSBI.subtract(
      JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(64)), // 2^64
      JSBI.BigInt(1)
    );
    // two64 / denominator
    const targetNum = JSBI.divide(two64, denominator);
    return pow.bigIntToUint8Array(targetNum);
  },
};
