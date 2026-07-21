import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, getRedirectResult } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
  experimentalForceLongPolling: true,
});
export const googleProvider = new GoogleAuthProvider();

export { getRedirectResult };

export const signInWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err: any) {
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
      // User dismissed the popup — treat as a no-op
      return null;
    }
    if (err.code === 'auth/popup-blocked') {
      // iOS Safari blocks popups by default. signInWithRedirect fails on iOS due to
      // sessionStorage partitioning (ITP), so we surface a clear message instead.
      throw new Error('POPUP_BLOCKED');
    }
    throw err;
  }
};

// 課題（デモ）用の匿名ログイン。実際の Google 認証は行わず、Firebase の匿名認証で
// uid だけを発行して Firestore の owner-only ルールを満たす。これによりアカウント
// 作成・Google ログインなしでアプリを一通り試せる。
// ※Firebase コンソールで「Authentication → Sign-in method → 匿名」を有効化しておくこと。
export const signInDemoAnonymously = async () => {
  return await signInAnonymously(auth);
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
