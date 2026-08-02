import { describe, expect, it } from "vitest";

import { classifyTask } from "../../src/shared/taskRouting";

describe("classifyTask", () => {
  it("treats an explanation of package.json as read-only code help", () => {
    expect(classifyTask("解释 package.json")).toMatchObject({
      intent: "simple_code",
      lane: "light",
      executionMode: "read_only",
    });
  });

  it("routes code explanations to the light read-only lane", () => {
    expect(classifyTask("请解释这段 TypeScript 的作用")).toMatchObject({
      intent: "simple_code",
      lane: "light",
      executionMode: "read_only",
      reasonCode: "code-explanation",
    });
  });

  it("routes project changes to the premium agentic lane", () => {
    expect(classifyTask("修复登录故障，修改多个文件并运行测试")).toMatchObject({
      intent: "complex_code",
      lane: "premium",
      executionMode: "agentic",
      reasonCode: "project-change",
    });
  });

  it.each([
    "什么是软件架构？",
    "请解释如何修复这个报错",
    "什么是 SVG？",
    "Explain the Canvas API",
  ])("keeps explanatory Chinese prompts read-only: %s", (prompt) => {
    expect(classifyTask(prompt)).toMatchObject({
      lane: "light",
      executionMode: "read_only",
    });
  });

  it.each([
    "What is the use of SVG?",
    "Explain how to use Canvas",
    "How do I use FFmpeg?",
    "请解释用 SVG 绘制图标的方法",
    "Explain video codecs",
    "Explain how to create an SVG icon",
    "Explain how to create an SVG icon and then make it responsive",
    "Explain how to create an SVG icon and then make the logo responsive",
    "How do I create an SVG diagram and then export it?",
    "How do I use SVG and then save it?",
    "Explain SVG and how to create a logo",
    "请解释用 SVG 绘制图标，然后生成动画的方法",
    "请解释 SVG，并说明如何创建一个徽标",
  ])("keeps media explanations light and read-only: %s", (prompt) => {
    expect(classifyTask(prompt)).toMatchObject({
      lane: "light",
      executionMode: "read_only",
    });
  });

  it.each([
    "Explain SVG and create one in this project",
    "请解释 SVG，然后生成一个图标",
    "Explain SVG and create a logo in this project",
    "Explain SVG, then create a diagram in this project",
    "Explain SVG; draw a banner for this project",
    "请解释 SVG，然后创建一个徽标",
    "请说明 Canvas，并绘制一张海报",
    "请解释 SVG，然后创建一个徽标，并说明如何让它响应式",
    "Explain how to create an SVG icon and then create a logo in this project",
    "How do I use SVG, then create a logo for this project?",
    "Explain SVG and also create a logo in this project",
    "如何使用 SVG，然后创建一个徽标",
    "请解释如何使用 SVG，然后创建一个图标",
    "请解释 SVG，然后在项目中创建一个徽标",
    "请解释 SVG，然后帮我创建一个徽标",
    "Explain SVG and then make it responsive in this project",
    "Explain SVG, and in this project create a logo",
    "Explain SVG, and for this project create a logo",
    "Explain SVG, then for this project save the icon",
    "请解释 SVG，然后创建一个徽标，并说明让它响应式的方法",
    "请解释 SVG，然后创建一个徽标，再介绍导出它的方法",
    "请解释 SVG，然后创建一个徽标，并请说明让它响应式的方法",
    "请解释 SVG，然后创建一个徽标，接着介绍导出它的方法",
  ])("routes a separate coordinated media action to premium: %s", (prompt) => {
    expect(classifyTask(prompt)).toMatchObject({
      intent: "media_script",
      lane: "premium",
      executionMode: "agentic",
      reasonCode: "media-generation",
    });
  });

  it.each([
    "How do I create an SVG icon and then export it to this project?",
    "Explain SVG and export the icon to this project",
    "Explain SVG and add the icon to this project",
    "Explain SVG and save the file in this project",
    "Explain SVG and write the file into this project",
    "Explain SVG and put the file in this project",
    "Explain SVG and store the file in this project",
    "Explain SVG and insert the icon into this project",
    "Explain SVG and include the icon in this project",
    "Explain SVG and copy the file into this project",
    "Explain SVG and move the file into this project",
    "Explain SVG and import the file into this project",
    "Explain SVG and embed the icon in this project",
    "Explain SVG and integrate the icon into this project",
  ])("routes project-scoped file actions to premium: %s", (prompt) => {
    expect(classifyTask(prompt)).toMatchObject({
      intent: "media_script",
      lane: "premium",
      executionMode: "agentic",
      reasonCode: "media-generation",
    });
  });

  it.each([
    "Create an SVG icon",
    "Draw a Canvas illustration",
    "Render a video with FFmpeg",
    "Produce an animation with Manim",
    "请用 SVG 绘制一个图标",
  ])("keeps explicit media creation premium and agentic: %s", (prompt) => {
    expect(classifyTask(prompt)).toMatchObject({
      intent: "media_script",
      lane: "premium",
      executionMode: "agentic",
      reasonCode: "media-generation",
    });
  });

  it("gives media generation precedence over other signals", () => {
    expect(classifyTask("用 Remotion 制作产品演示视频")).toMatchObject({
      intent: "media_script",
      lane: "premium",
      executionMode: "agentic",
      reasonCode: "media-generation",
    });
  });

  it.each([
    "画一只猫",
    "用 SVG 画一个图标",
    "Create a Canvas illustration",
    "使用 FFmpeg 生成片头",
    "用 Manim 绘制数学动画",
  ])("routes ordinary visual generation to premium agentic media: %s", (prompt) => {
    expect(classifyTask(prompt)).toMatchObject({
      intent: "media_script",
      lane: "premium",
      executionMode: "agentic",
      reasonCode: "media-generation",
    });
  });

  it("routes conflicting explanation and change requests to premium", () => {
    expect(classifyTask("解释问题并顺便修改代码")).toMatchObject({
      lane: "premium",
      executionMode: "agentic",
    });
  });

  it.each([
    ["Translate this paragraph into Chinese", "translation"],
    ["Polish this email for clarity", "polishing"],
    ["总结这篇文章的要点", "summarization"],
  ])("routes %s as a light text transform", (prompt) => {
    expect(classifyTask(prompt)).toMatchObject({
      intent: "simple_text",
      lane: "light",
      executionMode: "read_only",
      reasonCode: "text-transform",
    });
  });

  it.each([
    ["What is the capital of France?", "general question"],
    ["为什么会出现 404 错误？", "simple error explanation"],
  ])("routes a %s to the light read-only lane", (prompt) => {
    expect(classifyTask(prompt)).toMatchObject({
      intent: "simple_qa",
      lane: "light",
      executionMode: "read_only",
      reasonCode: "simple-question",
    });
  });

  it("defaults an unclear prompt to the premium agentic lane", () => {
    expect(classifyTask("帮我处理一下")).toEqual({
      intent: "complex_code",
      lane: "premium",
      executionMode: "agentic",
      confidence: "medium",
      reasonCode: "ambiguous-premium-default",
    });
  });

  it("keeps unclear question-mark requests in the premium fallback", () => {
    expect(classifyTask("Could you handle this complicated task?")).toMatchObject({
      intent: "complex_code",
      lane: "premium",
      executionMode: "agentic",
      reasonCode: "ambiguous-premium-default",
    });
  });

  it.each([
    ["Explain the test command in this code.", "test"],
    ["Explain the build pipeline in this code.", "build"],
    ["What does change mean in this code?", "change"],
  ])("keeps explanatory uses of %s read-only", (prompt) => {
    expect(classifyTask(prompt)).toMatchObject({
      intent: "simple_code",
      lane: "light",
      executionMode: "read_only",
      reasonCode: "code-explanation",
    });
  });

  it("does not use prompt length alone to escalate a general question", () => {
    const prompt = `What is the capital of France? ${"Please explain simply. ".repeat(80)}`;

    expect(classifyTask(prompt)).toMatchObject({
      intent: "simple_qa",
      lane: "light",
      executionMode: "read_only",
    });
  });

  it("returns a fresh immutable decision for each classification", () => {
    const first = classifyTask("What is TypeScript?");
    const second = classifyTask("What is TypeScript?");

    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
