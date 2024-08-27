import crypto from 'crypto';
import BN from 'bn.js';

class VSS {
  constructor(t, n) {
    this.t = t; // Threshold
    this.n = n; // Total number of participants
    this.prime = new BN('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F', 16); // secp256k1 prime
    this.g = new BN(2); // Generator for the group
  }

  generateShares(secret) {
    const secretBN = new BN(secret, 16);
    this.coefficients = [secretBN];
    for (let i = 1; i < this.t; i++) {
      this.coefficients.push(new BN(crypto.randomBytes(32)).mod(this.prime));
    }

    const shares = [];
    for (let i = 1; i <= this.n; i++) {
      let share = new BN(0);
      for (let j = 0; j < this.t; j++) {
        share = share.add(this.coefficients[j].mul(new BN(i).pow(new BN(j))).mod(this.prime));
      }
      shares.push({ x: i, y: share.mod(this.prime) });
    }

    console.log('Generated shares:', shares.map(s => ({ x: s.x, y: s.y.toString(16) })));
    return shares;
  }

  generateCommitments() {
    console.log('Generating commitments...');
    if (!this.coefficients) {
      console.log('Coefficients not generated. Call generateShares first.');
      throw new Error('Coefficients not generated. Call generateShares first.');
    }
    console.log('Coefficients:', this.coefficients.map(c => c.toString(16)));
    
    const commitments = this.coefficients.map((coeff, index) => {
      console.log(`Calculating commitment for coefficient ${index}:`, coeff.toString(16));
      const commitment = this.efficientModPow(this.g, coeff, this.prime);
      console.log(`Commitment ${index}:`, commitment.toString(16));
      return commitment;
    });

    console.log('Generated commitments:', commitments.map(c => c.toString(16)));
    return commitments;
  }

  efficientModPow(base, exponent, modulus) {
    if (modulus.eq(new BN(1))) return new BN(0);
    let result = new BN(1);
    base = base.mod(modulus);
    while (exponent.gt(new BN(0))) {
      if (exponent.isOdd()) {
        result = result.mul(base).mod(modulus);
      }
      exponent = exponent.shrn(1);
      base = base.mul(base).mod(modulus);
    }
    return result;
  }

  reconstructSecret(shares) {
    let secret = new BN(0);
    for (let i = 0; i < shares.length; i++) {
      let numerator = new BN(1);
      let denominator = new BN(1);
      for (let j = 0; j < shares.length; j++) {
        if (i !== j) {
          numerator = numerator.mul(new BN(shares[j].x).neg()).mod(this.prime);
          denominator = denominator.mul(new BN(shares[i].x).sub(new BN(shares[j].x))).mod(this.prime);
        }
      }
      let lagrange = numerator.mul(denominator.invm(this.prime)).mod(this.prime);
      secret = secret.add(shares[i].y.mul(lagrange)).mod(this.prime);
    }
    console.log('Reconstructed secret:', secret.toString(16));
    return secret;
  }

  verifyShare(share, commitments) {
    let y = new BN(1);
    for (let i = 0; i < commitments.length; i++) {
      y = y.mul(this.efficientModPow(commitments[i], new BN(share.x).pow(new BN(i)), this.prime)).mod(this.prime);
    }
    const isValid = this.efficientModPow(this.g, share.y, this.prime).eq(y);
    console.log('Share verification result:', isValid);
    return isValid;
  }
}

export { VSS };
export default VSS;