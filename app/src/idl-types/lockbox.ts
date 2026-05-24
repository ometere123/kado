/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lockbox.json`.
 */
export type Lockbox = {
  "address": "3x3vj8CQXrbZuajp7g4eq3bUhbzffbhiXX2RC1UfmGhr",
  "metadata": {
    "name": "lockbox",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Nexus Protocol — Lockbox: claim-link transfers with expiry auto-refund."
  },
  "instructions": [
    {
      "name": "claim",
      "docs": [
        "Recipient claims with the matching nonce, before expiry."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "transfer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "transfer.sender",
                "account": "pendingTransfer"
              },
              {
                "kind": "account",
                "path": "transfer.claim_nonce",
                "account": "pendingTransfer"
              }
            ]
          }
        },
        {
          "name": "escrowTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "transfer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "transfer.rlo_mint",
                "account": "pendingTransfer"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipientTokenAccount",
          "writable": true
        },
        {
          "name": "senderAccount",
          "docs": [
            "Used only so we can pass its AccountInfo for clarity; not a signer.",
            "Address constraint matches the on-chain `transfer.sender`."
          ]
        },
        {
          "name": "recipient",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "claimNonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "createTransfer",
      "docs": [
        "Sender locks `amount` $RLO into a PDA escrow, claimable by `recipient`",
        "only if they can present `claim_nonce` before `expiry_seconds` elapse."
      ],
      "discriminator": [
        142,
        232,
        86,
        212,
        85,
        158,
        131,
        190
      ],
      "accounts": [
        {
          "name": "transfer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "arg",
                "path": "claimNonce"
              }
            ]
          }
        },
        {
          "name": "rloMint"
        },
        {
          "name": "escrowTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "transfer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "rloMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "senderTokenAccount",
          "writable": true
        },
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "recipient",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "expirySeconds",
          "type": "i64"
        },
        {
          "name": "claimNonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "refund",
      "docs": [
        "After expiry, the sender refunds locked tokens back to themselves."
      ],
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "transfer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "transfer.sender",
                "account": "pendingTransfer"
              },
              {
                "kind": "account",
                "path": "transfer.claim_nonce",
                "account": "pendingTransfer"
              }
            ]
          }
        },
        {
          "name": "escrowTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "transfer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "transfer.rlo_mint",
                "account": "pendingTransfer"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "senderTokenAccount",
          "writable": true
        },
        {
          "name": "sender",
          "writable": true,
          "signer": true,
          "relations": [
            "transfer"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "pendingTransfer",
      "discriminator": [
        136,
        107,
        78,
        115,
        95,
        81,
        142,
        155
      ]
    }
  ],
  "events": [
    {
      "name": "transferClaimed",
      "discriminator": [
        145,
        226,
        18,
        63,
        217,
        2,
        35,
        236
      ]
    },
    {
      "name": "transferCreated",
      "discriminator": [
        26,
        150,
        222,
        191,
        158,
        158,
        186,
        179
      ]
    },
    {
      "name": "transferRefunded",
      "discriminator": [
        176,
        166,
        100,
        242,
        195,
        130,
        30,
        130
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be > 0."
    },
    {
      "code": 6001,
      "name": "invalidExpiry",
      "msg": "Expiry seconds must be positive."
    },
    {
      "code": 6002,
      "name": "alreadyClaimed",
      "msg": "Transfer was already claimed or refunded."
    },
    {
      "code": 6003,
      "name": "wrongRecipient",
      "msg": "Signer is not the designated recipient."
    },
    {
      "code": 6004,
      "name": "wrongNonce",
      "msg": "Claim nonce mismatch."
    },
    {
      "code": 6005,
      "name": "expired",
      "msg": "Transfer has expired."
    },
    {
      "code": 6006,
      "name": "notYetExpired",
      "msg": "Transfer has not yet expired."
    }
  ],
  "types": [
    {
      "name": "pendingTransfer",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "expiryTimestamp",
            "type": "i64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "claimNonce",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rloMint",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "transferClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "transfer",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "claimedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "transferCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "transfer",
            "type": "pubkey"
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "expiryTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "transferRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "transfer",
            "type": "pubkey"
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
