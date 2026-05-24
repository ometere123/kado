/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/forge.json`.
 */
export type Forge = {
  "address": "7WZXB6stHDsHgq8fUS4RfSu8UyDJWjHFCQbULGarErp4",
  "metadata": {
    "name": "forge",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Nexus Protocol — Forge (SCALE): agent-economy task board with $RLO escrow."
  },
  "instructions": [
    {
      "name": "approveWork",
      "docs": [
        "Poster approves submitted work → escrow released to agent."
      ],
      "discriminator": [
        181,
        118,
        45,
        143,
        204,
        88,
        237,
        109
      ],
      "accounts": [
        {
          "name": "task",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "task.poster",
                "account": "task"
              },
              {
                "kind": "account",
                "path": "task.nonce",
                "account": "task"
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
                "path": "task"
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
                "path": "task.rlo_mint",
                "account": "task"
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
          "name": "payoutTokenAccount",
          "docs": [
            "For approve_work: agent's ATA. For reject_work: poster's ATA.",
            "Handler relies on the caller passing the correct one. Mint must match."
          ],
          "writable": true
        },
        {
          "name": "poster",
          "writable": true,
          "signer": true,
          "relations": [
            "task"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "assignAgent",
      "docs": [
        "Poster picks a winning agent. Must reference that agent's Bid PDA."
      ],
      "discriminator": [
        146,
        145,
        237,
        81,
        75,
        46,
        30,
        190
      ],
      "accounts": [
        {
          "name": "task",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "task.poster",
                "account": "task"
              },
              {
                "kind": "account",
                "path": "task.nonce",
                "account": "task"
              }
            ]
          }
        },
        {
          "name": "bid",
          "docs": [
            "The winning bid PDA — its `agent` is what we copy onto the task."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "task"
              },
              {
                "kind": "account",
                "path": "bid.agent",
                "account": "bid"
              }
            ]
          }
        },
        {
          "name": "poster",
          "signer": true,
          "relations": [
            "task"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "bidOnTask",
      "docs": [
        "Register a bid on an Open task. Creates a small Bid PDA per (task, agent)."
      ],
      "discriminator": [
        206,
        149,
        114,
        181,
        142,
        96,
        12,
        145
      ],
      "accounts": [
        {
          "name": "task"
        },
        {
          "name": "bid",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "task"
              },
              {
                "kind": "account",
                "path": "agent"
              }
            ]
          }
        },
        {
          "name": "agent",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "postTask",
      "docs": [
        "Create a new task and lock the reward into escrow.",
        "`nonce` lets the same poster have many tasks (each task PDA derives from it)."
      ],
      "discriminator": [
        186,
        136,
        157,
        9,
        235,
        251,
        62,
        142
      ],
      "accounts": [
        {
          "name": "task",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "poster"
              },
              {
                "kind": "arg",
                "path": "nonce"
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
                "path": "task"
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
          "name": "posterTokenAccount",
          "writable": true
        },
        {
          "name": "poster",
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
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "reward",
          "type": "u64"
        },
        {
          "name": "deadline",
          "type": "i64"
        }
      ]
    },
    {
      "name": "rejectWork",
      "docs": [
        "Poster rejects submitted work → escrow returned to poster."
      ],
      "discriminator": [
        129,
        238,
        59,
        133,
        63,
        148,
        130,
        54
      ],
      "accounts": [
        {
          "name": "task",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "task.poster",
                "account": "task"
              },
              {
                "kind": "account",
                "path": "task.nonce",
                "account": "task"
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
                "path": "task"
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
                "path": "task.rlo_mint",
                "account": "task"
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
          "name": "payoutTokenAccount",
          "docs": [
            "For approve_work: agent's ATA. For reject_work: poster's ATA.",
            "Handler relies on the caller passing the correct one. Mint must match."
          ],
          "writable": true
        },
        {
          "name": "poster",
          "writable": true,
          "signer": true,
          "relations": [
            "task"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "submitWork",
      "docs": [
        "Assigned agent submits the result hash + URI."
      ],
      "discriminator": [
        158,
        80,
        101,
        51,
        114,
        130,
        101,
        253
      ],
      "accounts": [
        {
          "name": "task",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "task.poster",
                "account": "task"
              },
              {
                "kind": "account",
                "path": "task.nonce",
                "account": "task"
              }
            ]
          }
        },
        {
          "name": "agent",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "resultHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "resultUri",
          "type": "string"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bid",
      "discriminator": [
        143,
        246,
        48,
        245,
        42,
        145,
        180,
        88
      ]
    },
    {
      "name": "task",
      "discriminator": [
        79,
        34,
        229,
        55,
        88,
        90,
        55,
        84
      ]
    }
  ],
  "events": [
    {
      "name": "bidPlaced",
      "discriminator": [
        135,
        53,
        176,
        83,
        193,
        69,
        108,
        61
      ]
    },
    {
      "name": "taskAssigned",
      "discriminator": [
        67,
        8,
        87,
        59,
        111,
        91,
        204,
        170
      ]
    },
    {
      "name": "taskPosted",
      "discriminator": [
        152,
        102,
        197,
        165,
        115,
        29,
        250,
        3
      ]
    },
    {
      "name": "workApproved",
      "discriminator": [
        82,
        19,
        106,
        191,
        46,
        255,
        164,
        142
      ]
    },
    {
      "name": "workRejected",
      "discriminator": [
        155,
        17,
        186,
        185,
        27,
        160,
        202,
        169
      ]
    },
    {
      "name": "workSubmitted",
      "discriminator": [
        136,
        185,
        210,
        174,
        216,
        140,
        64,
        125
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroReward",
      "msg": "Reward must be > 0."
    },
    {
      "code": 6001,
      "name": "deadlineInPast",
      "msg": "Deadline must be in the future."
    },
    {
      "code": 6002,
      "name": "deadlinePassed",
      "msg": "Deadline has already passed."
    },
    {
      "code": 6003,
      "name": "descriptionTooLong",
      "msg": "Description too long."
    },
    {
      "code": 6004,
      "name": "uriTooLong",
      "msg": "URI too long."
    },
    {
      "code": 6005,
      "name": "notOpenForBids",
      "msg": "Task is not Open (not accepting bids/assignment)."
    },
    {
      "code": 6006,
      "name": "bidTaskMismatch",
      "msg": "Bid references a different task."
    },
    {
      "code": 6007,
      "name": "notAssigned",
      "msg": "Task has not been assigned to an agent yet."
    },
    {
      "code": 6008,
      "name": "notAssignedAgent",
      "msg": "Signer is not the assigned agent."
    },
    {
      "code": 6009,
      "name": "notSubmitted",
      "msg": "Task is not in Submitted state."
    }
  ],
  "types": [
    {
      "name": "bid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "task",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bidPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "task",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "task",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poster",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "reward",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "taskStatus"
              }
            }
          },
          {
            "name": "resultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "resultUri",
            "type": "string"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "rloMint",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "taskAssigned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "task",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "taskPosted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "task",
            "type": "pubkey"
          },
          {
            "name": "poster",
            "type": "pubkey"
          },
          {
            "name": "reward",
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "taskStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "assigned"
          },
          {
            "name": "submitted"
          },
          {
            "name": "approved"
          },
          {
            "name": "rejected"
          }
        ]
      }
    },
    {
      "name": "workApproved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "task",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "reward",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "workRejected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "task",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "reward",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "workSubmitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "task",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          }
        ]
      }
    }
  ]
};
