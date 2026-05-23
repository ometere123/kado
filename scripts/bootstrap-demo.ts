// Bootstrap demo wallet for stage presentations.
// Usage: npx ts-node scripts/bootstrap-demo.ts
import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram, clusterApiUrl, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, transfer } from '@solana/spl-token';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { Vault } from '../target/types/vault';
import { Streamline } from '../target/types/streamline';
import { FluxAmm } from '../target/types/flux_amm';
import { Forge } from '../target/types/forge';
import { RLO_MINT, USDC_MINT, RLO_DECIMALS, USDC_DECIMALS } from '../shared/config';
const D = 10n ** 6n;
const toRaw = (n: bigint) => n * D;
const loadKp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
const loadIdl = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'target', 'idl', n + '.json'), 'utf8'));
const canonical = (a: PublicKey, b: PublicKey): [PublicKey, PublicKey] => Buffer.compare(a.toBuffer(), b.toBuffer()) < 0 ? [a, b] : [b, a];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function main() {
  const deployerPath = process.env.DEPLOYER_KEYPAIR ?? path.join(os.homedir(), '.config', 'solana', 'id.json');
  const deployer = loadKp(deployerPath);
  const demoPath = path.join(__dirname, 'demo-wallet.json');
  let demo: Keypair;
  if (fs.existsSync(demoPath)) { demo = loadKp(demoPath); console.log('Reusing demo wallet:', demo.publicKey.toBase58()); }
  else { demo = Keypair.generate(); fs.writeFileSync(demoPath, JSON.stringify(Array.from(demo.secretKey))); console.log('Created demo wallet:', demo.publicKey.toBase58()); }
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const deployerProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(deployer), { commitment: 'confirmed' });
  const demoProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(demo), { commitment: 'confirmed' });
  const rloMint = new PublicKey(RLO_MINT); const usdcMint = new PublicKey(USDC_MINT);
  const solBal = await connection.getBalance(demo.publicKey);
  if (solBal < LAMPORTS_PER_SOL) { const s = await connection.requestAirdrop(demo.publicKey, 2 * LAMPORTS_PER_SOL); await connection.confirmTransaction(s, 'confirmed'); console.log('+ 2 SOL airdropped'); await sleep(2000); }
  else { console.log('+ SOL ok'); }
  const demoRloAta = (await getOrCreateAssociatedTokenAccount(connection, deployer, rloMint, demo.publicKey)).address;
  const depRloAta = (await getOrCreateAssociatedTokenAccount(connection, deployer, rloMint, deployer.publicKey)).address;
  const rloBal = BigInt((await connection.getTokenAccountBalance(demoRloAta)).value.amount);
  if (rloBal < toRaw(10_000n)) { const s = await transfer(connection, deployer, depRloAta, demoRloAta, deployer, Number(toRaw(10_000n)-rloBal)); console.log('+ 10k $RLO. Tx:', s); await sleep(2000); }
  const demoUsdcAta = (await getOrCreateAssociatedTokenAccount(connection, deployer, usdcMint, demo.publicKey)).address;
  const depUsdcAta = (await getOrCreateAssociatedTokenAccount(connection, deployer, usdcMint, deployer.publicKey)).address;
  const usdcBal = BigInt((await connection.getTokenAccountBalance(demoUsdcAta)).value.amount);
  if (usdcBal < toRaw(1_000n)) { const s = await transfer(connection, deployer, depUsdcAta, demoUsdcAta, deployer, Number(toRaw(1_000n)-usdcBal)); console.log('+ 1k $USDC. Tx:', s); await sleep(2000); }
  anchor.setProvider(demoProvider);
  const vaultProg = new Program<Vault>(loadIdl('vault'), demoProvider);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault'), demo.publicKey.toBuffer()], vaultProg.programId);
  const vaultAta = getAssociatedTokenAddressSync(rloMint, vaultPda, true);
  const demoRloAtaPk = getAssociatedTokenAddressSync(rloMint, demo.publicKey);
  if (!await connection.getAccountInfo(vaultPda)) { const s = await vaultProg.methods.initializeVault(4,7000).accounts({vault:vaultPda,rloMint,vaultTokenAccount:vaultAta,owner:demo.publicKey,tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId}as any).signers([demo]).rpc(); console.log('+ Vault opened. Tx:',s); await sleep(2000); }
  let vs = await (vaultProg.account as any).collateralVault.fetch(vaultPda);
  if (BigInt(vs.stakedAmount.toString()) < toRaw(5_000n)) { const n=toRaw(5_000n)-BigInt(vs.stakedAmount.toString()); const s=await vaultProg.methods.stake(new BN(n.toString())).accounts({vault:vaultPda,vaultTokenAccount:vaultAta,ownerTokenAccount:demoRloAtaPk,rloMint,owner:demo.publicKey,tokenProgram:TOKEN_PROGRAM_ID}as any).signers([demo]).rpc(); console.log('+ 5k staked. Tx:',s); await sleep(2000); }
  const [tPda] = PublicKey.findProgramAddressSync([Buffer.from('treasury')], vaultProg.programId);
  const tAta = getAssociatedTokenAddressSync(rloMint, tPda, true);
  vs = await (vaultProg.account as any).collateralVault.fetch(vaultPda);
  if (BigInt(vs.borrowedAmount.toString()) < toRaw(2_000n)) { const n=toRaw(2_000n)-BigInt(vs.borrowedAmount.toString()); const s=await vaultProg.methods.borrow(new BN(n.toString())).accounts({vault:vaultPda,treasury:tPda,treasuryTokenAccount:tAta,ownerTokenAccount:demoRloAtaPk,rloMint,owner:demo.publicKey,tokenProgram:TOKEN_PROGRAM_ID}as any).signers([demo]).rpc(); console.log('+ 2k borrowed. Tx:',s); await sleep(2000); }
  const streamProg = new Program<Streamline>(loadIdl('streamline'), demoProvider);
  const recipient = Keypair.generate().publicKey;
  const [sPda] = PublicKey.findProgramAddressSync([Buffer.from('schedule'),demo.publicKey.toBuffer(),recipient.toBuffer()], streamProg.programId);
  if (!await connection.getAccountInfo(sPda)) { const rAta=getAssociatedTokenAddressSync(rloMint,recipient); const [eAta]=PublicKey.findProgramAddressSync([Buffer.from('escrow'),sPda.toBuffer()],streamProg.programId); const s=await streamProg.methods.createSchedule(recipient,new BN(toRaw(100n).toString()),new BN(86400),30).accounts({schedule:sPda,rloMint,escrowTokenAccount:eAta,payerTokenAccount:demoRloAtaPk,recipientAccount:rAta,payer:demo.publicKey,tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId,rent:anchor.web3.SYSVAR_RENT_PUBKEY}as any).signers([demo]).rpc(); console.log('+ Schedule 100/day x30. Tx:',s); await sleep(2000); }
  const forgeProg = new Program<Forge>(loadIdl('forge'), demoProvider);
  for (let i = 1; i <= 2; i++) { const nonce=BigInt(1_000_000+i); const nb=Buffer.alloc(8); nb.writeBigUInt64LE(nonce); const [tpda]=PublicKey.findProgramAddressSync([Buffer.from('task'),demo.publicKey.toBuffer(),nb],forgeProg.programId); if (await connection.getAccountInfo(tpda)){console.log('+ Bounty',i,'ok');continue;} const te=getAssociatedTokenAddressSync(rloMint,tpda,true); const dl=Math.floor(Date.now()/1000)+7*24*3600; const desc=`Demo bounty ${i}: on-chain agent coordination`; const s=await forgeProg.methods.postTask(new BN(nonce.toString()),desc,new BN(toRaw(500n).toString()),new BN(dl)).accounts({task:tpda,rloMint,escrowTokenAccount:te,posterTokenAccount:demoRloAtaPk,poster:demo.publicKey,tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId,rent:anchor.web3.SYSVAR_RENT_PUBKEY}as any).signers([demo]).rpc(); console.log(`+ Bounty ${i}. Tx:`,s); await sleep(2000); }
  const fluxProg = new Program<FluxAmm>(loadIdl('flux_amm'), demoProvider);
  const [mA,mB]=canonical(rloMint,usdcMint); const aIsRlo=mA.equals(rloMint);
  const [poolPda]=PublicKey.findProgramAddressSync([Buffer.from('pool'),mA.toBuffer(),mB.toBuffer()],fluxProg.programId);
  const [lpMint]=PublicKey.findProgramAddressSync([Buffer.from('lp_mint'),poolPda.toBuffer()],fluxProg.programId);
  const ptA=getAssociatedTokenAddressSync(mA,poolPda,true); const ptB=getAssociatedTokenAddressSync(mB,poolPda,true);
  const dA=getAssociatedTokenAddressSync(mA,demo.publicKey); const dB=getAssociatedTokenAddressSync(mB,demo.publicKey);
  const lpAta=(await getOrCreateAssociatedTokenAccount(connection,demo,lpMint,demo.publicKey)).address;
  const amtA=aIsRlo?toRaw(1_000n):toRaw(1_000n); const amtB=toRaw(1_000n);
  try { const s=await fluxProg.methods.addLiquidity(new BN(amtA.toString()),new BN(amtB.toString())).accounts({pool:poolPda,lpMint,poolTokenA:ptA,poolTokenB:ptB,userTokenA:dA,userTokenB:dB,userLpAccount:lpAta,user:demo.publicKey,tokenProgram:TOKEN_PROGRAM_ID}as any).signers([demo]).rpc(); console.log('+ Flux LP. Tx:',s); } catch(e:any){console.warn('! Flux LP:',e?.message);}
  console.log(''); console.log('='.repeat(50)); console.log('  DEMO WALLET:', demo.publicKey.toBase58()); console.log('  Key file:', demoPath); console.log('  Ready: 5k staked | 2k borrowed | schedule 100/day | 2 bounties | LP'); console.log('='.repeat(50));
}
main().catch(e => { console.error(e); process.exit(1); });