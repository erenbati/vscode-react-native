// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import assert = require("assert");
import Sinon = require("sinon");
import proxyquire = require("proxyquire");
import type * as vscode from "vscode";

suite("selectAndInsertDebugConfigurationCommand", function () {
    function createCommandModule() {
        const document = {
            uri: { fsPath: "launch.json" },
        } as unknown as vscode.TextDocument;
        const position = { line: 0, character: 1 } as vscode.Position;
        const token = { isCancellationRequested: false } as vscode.CancellationToken;
        const config = { type: "reactnative", request: "launch", name: "Attach" };
        const folder = { name: "project" };
        const edits: FakeWorkspaceEdit[] = [];

        class FakeWorkspaceEdit {
            public insert = Sinon.stub();

            constructor() {
                edits.push(this);
            }
        }

        const window = {
            activeTextEditor: { document },
        };
        const getWorkspaceFolderStub = Sinon.stub().returns(folder);
        const applyEditStub = Sinon.stub().returns(Promise.resolve(true));
        const executeCommandStub = Sinon.stub().returns(Promise.resolve());
        const provideConfigurationStub = Sinon.stub().returns(Promise.resolve(config));
        const getCursorPositionStub = Sinon.stub().returns("AfterItem");
        const isCommaBeforeCursorStub = Sinon.stub().returns(false);
        const getTextForInsertionStub = Sinon.stub().returns('{"name":"Attach"}');

        class FakeCommand {
            public static formInstance(): any {
                return new this();
            }
        }

        const module = proxyquire.noCallThru()(
            "../../../src/extension/commands/selectAndInsertDebugConfiguration",
            {
                vscode: {
                    window,
                    workspace: {
                        getWorkspaceFolder: getWorkspaceFolderStub,
                        applyEdit: applyEditStub,
                    },
                    WorkspaceEdit: FakeWorkspaceEdit,
                    commands: {
                        executeCommand: executeCommandStub,
                    },
                },
                "../rn-extension": {
                    getDebugConfigProvider: () => ({
                        provideDebugConfigurationSequentially: provideConfigurationStub,
                    }),
                },
                "../../common/launchJsonCompletionHelper": {
                    LaunchJsonCompletionHelper: {
                        getCursorPositionInConfigurationsArray: getCursorPositionStub,
                        isCommaImmediatelyBeforeCursor: isCommaBeforeCursorStub,
                        getTextForInsertion: getTextForInsertionStub,
                    },
                },
                "../../common/error/errorHelper": {
                    ErrorHelper: {
                        getInternalError: () => new Error("debug configuration failed"),
                    },
                },
                "../../common/error/internalErrorCode": {
                    InternalErrorCode: {
                        CommandFailed: 0,
                    },
                },
                "./util/command": {
                    Command: FakeCommand,
                },
            },
        ) as typeof import("../../../src/extension/commands/selectAndInsertDebugConfiguration");

        return {
            SelectAndInsertDebugConfiguration: module.SelectAndInsertDebugConfiguration,
            document,
            position,
            token,
            config,
            folder,
            edits,
            window,
            getWorkspaceFolderStub,
            applyEditStub,
            executeCommandStub,
            provideConfigurationStub,
            getCursorPositionStub,
            isCommaBeforeCursorStub,
            getTextForInsertionStub,
        };
    }

    type CommandStubs = ReturnType<typeof createCommandModule>;

    async function runCommand(
        stubs: CommandStubs,
        token: vscode.CancellationToken = stubs.token,
    ): Promise<void> {
        const command = stubs.SelectAndInsertDebugConfiguration.formInstance();
        await command.baseFn(stubs.document, stubs.position, token);
    }

    test("should skip insertion when the document is not active", async function () {
        const stubs = createCommandModule();
        stubs.window.activeTextEditor.document = {
            uri: { fsPath: "other.json" },
        } as unknown as vscode.TextDocument;

        await runCommand(stubs);

        assert.strictEqual(stubs.provideConfigurationStub.called, false);
        assert.strictEqual(stubs.applyEditStub.called, false);
    });

    test("should skip insertion when configuration selection is canceled", async function () {
        const stubs = createCommandModule();
        stubs.provideConfigurationStub.returns(Promise.resolve(undefined));

        await runCommand(stubs);

        assert.strictEqual(stubs.provideConfigurationStub.calledOnce, true);
        assert.strictEqual(stubs.getCursorPositionStub.called, false);
        assert.strictEqual(stubs.applyEditStub.called, false);
    });

    test("should skip insertion when cancellation is requested", async function () {
        const stubs = createCommandModule();
        const canceledToken = {
            isCancellationRequested: true,
        } as vscode.CancellationToken;

        await runCommand(stubs, canceledToken);

        assert.strictEqual(
            stubs.provideConfigurationStub.calledWithExactly(stubs.folder, canceledToken),
            true,
        );
        assert.strictEqual(stubs.getCursorPositionStub.called, false);
        assert.strictEqual(stubs.applyEditStub.called, false);
    });

    test("should skip insertion when the cursor is outside configurations", async function () {
        const stubs = createCommandModule();
        stubs.getCursorPositionStub.returns(undefined);

        await runCommand(stubs);

        assert.strictEqual(stubs.getTextForInsertionStub.called, false);
        assert.strictEqual(stubs.applyEditStub.called, false);
    });

    test("should apply a workspace edit and format the document", async function () {
        const stubs = createCommandModule();

        await runCommand(stubs);

        assert.strictEqual(
            stubs.getWorkspaceFolderStub.calledWithExactly(stubs.document.uri),
            true,
        );
        assert.strictEqual(
            stubs.getCursorPositionStub.calledWithExactly(stubs.document, stubs.position),
            true,
        );
        assert.strictEqual(
            stubs.getTextForInsertionStub.calledWithExactly(
                stubs.config,
                "AfterItem",
                undefined,
            ),
            true,
        );
        assert.strictEqual(stubs.edits.length, 1);
        assert.strictEqual(
            stubs.edits[0].insert.calledWithExactly(
                stubs.document.uri,
                stubs.position,
                '{"name":"Attach"}',
            ),
            true,
        );
        assert.strictEqual(stubs.applyEditStub.calledWithExactly(stubs.edits[0]), true);
        assert.strictEqual(
            stubs.executeCommandStub.calledWithExactly("editor.action.formatDocument"),
            true,
        );
    });

    test("should preserve the comma-before-cursor insertion mode", async function () {
        const stubs = createCommandModule();
        stubs.isCommaBeforeCursorStub.returns(true);

        await runCommand(stubs);

        assert.strictEqual(
            stubs.getTextForInsertionStub.calledWithExactly(
                stubs.config,
                "AfterItem",
                "BeforeCursor",
            ),
            true,
        );
        assert.strictEqual(stubs.applyEditStub.calledOnce, true);
    });

    test("should propagate an edit failure without formatting", async function () {
        const stubs = createCommandModule();
        const error = new Error("workspace edit failed");
        stubs.applyEditStub.returns(Promise.reject(error));

        await assert.rejects(() => runCommand(stubs), error);

        assert.strictEqual(stubs.executeCommandStub.called, false);
    });
});
