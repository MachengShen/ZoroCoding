export type TaskIntent =
  | "simple_qa"
  | "simple_text"
  | "simple_code"
  | "complex_code"
  | "media_script";

export type ModelLane = "light" | "premium";
export type TaskExecutionMode = "read_only" | "agentic";
export type RouteConfidence = "high" | "medium";
export type RouteReasonCode =
  | "simple-question"
  | "text-transform"
  | "code-explanation"
  | "project-change"
  | "multi-step-code"
  | "media-generation"
  | "ambiguous-premium-default";

export interface RouteDecision {
  intent: TaskIntent;
  lane: ModelLane;
  executionMode: TaskExecutionMode;
  confidence: RouteConfidence;
  reasonCode: RouteReasonCode;
}

export type ModelSelection =
  | { mode: "auto" }
  | { mode: "manual"; providerId: string };

const MEDIA_TOPIC =
  /\b(?:svg|canvas|ffmpeg|manim|remotion|video codecs?|image generation)\b|视频编码|图像生成/;
const MEDIA_EXPLANATION_PREFIX =
  /^(?:what (?:is|are)\b|explain\b|how do i use\b|can you explain\b|(?:请)?(?:解释|说明|介绍|什么是|为什么|如何|怎么))/;
const ENGLISH_MEDIA_TUTORIAL_PREFIX =
  /^(?:(?:can you )?explain how to\b|how do i\b)/;
const CHINESE_MEDIA_TUTORIAL_METHOD =
  /^(?:请)?(?:解释|说明|介绍).{0,160}方法(?:[？?。.]|$)/;
const ENGLISH_MEDIA_CLAUSE_BOUNDARY =
  /(?:\b(?:and|then)\b|[,;.!?])[\s,;:!?]*(?:(?:and|then|also)\s+){0,2}/g;
const ENGLISH_PROJECT_ACTION_PREFIX =
  /^(?:please\s+)?(?:(?:in|within|for)\s+(?:this|the(?:\s+current)?|current)\s+project\s+)?/;
const ENGLISH_CREATION_CLAUSE =
  /^(?:create|draw|illustrate|render|generate|animate|produce)\b/;
const ENGLISH_PROJECT_ADJUSTMENT_CLAUSE =
  /^(?:make|adjust|update|change|resize|style)\b/;
const ENGLISH_PROJECT_FILE_ACTION_CLAUSE =
  /^(?:export|add|save|write|put|store|insert|include|copy|move|import|embed|integrate)\b/;
const ENGLISH_PROJECT_INDICATOR =
  /\b(?:in(?:to)?|within|for|to)\s+(?:this|the(?:\s+current)?|current)\s+project\b/;
const CHINESE_COORDINATED_MEDIA_ACTION =
  /(?:[，。；、,.;!?！？]\s*(?:(?:然后|并且|并|同时|再|顺便)\s*)?|(?:然后|并且|并|同时|再|顺便)\s*)(?:请)?(?:(?:在(?:这个|本)?项目中|帮我)\s*)*(?:生成|创建|画|绘制|制作|渲染)/;
const CHINESE_EXPLANATION_CLAUSE =
  /[，,；;。.!！？?]\s*[^，,；;。.!！？?]{0,20}?(?:说明|介绍|解释|讲解|阐述)/;
const MEDIA_GENERATION =
  /\b(?:create|draw|illustrate|render|generate|animate|make|produce)\b.{0,40}\b(?:svg|canvas|ffmpeg|manim|remotion|video|animation|image|icon|illustration|graphic)\b|\b(?:svg|canvas|ffmpeg|manim|remotion)\b.{0,40}\b(?:draw|illustrate|render|generate|animate|create|make|produce)\b|(?:用|使用).{0,12}(?:remotion|svg|canvas|ffmpeg|manim).{0,20}(?:画|绘制|生成|制作)|制作.{0,12}(视频|动画)|生成.{0,12}(视频|动画|图片|图标)|视频制作|动画制作|(?:画|绘制|绘图).{0,20}(?:猫|狗|图|图标|插画|图片|动画|场景)/;
const ENGLISH_PROJECT_MUTATION =
  /^(?:please\s+)?(?:fix|implement|modify|change|refactor|build|test|install|deploy)\b|\b(?:can|could) you\s+(?:fix|implement|modify|change|refactor|build|test|install|deploy)\b|\b(?:run|execute) tests?\b|\b(?:modify|change)\s+(?:multiple|several) files\b/;
const CHINESE_PROJECT_MUTATION =
  /修复|修改|实现|重构|构建|运行测试|安装|部署|多个文件/;
const CHINESE_EXPLANATION_PREFIX =
  /^(?:请)?(?:解释|说明|介绍|什么是|为什么|如何理解|怎么理解)/;
const CHINESE_FOLLOWED_MUTATION =
  /(?:并|然后|顺便|同时|再).{0,12}(?:修复|修改|实现|重构|构建|运行测试|安装|部署)/;
const CODE_EXPLANATION =
  /\b(typescript|javascript|python|code|function|class|stack trace|package\.json|svg|canvas|ffmpeg|manim)\b|\b(explain|what does).{0,40}\b(typescript|javascript|python|code|function|class|stack trace|package\.json|svg|canvas|ffmpeg|manim)\b|解释.{0,20}(代码|typescript|ts|package\.json|报错|错误|故障|修复)|这段.{0,8}(代码|typescript|ts)|代码.{0,8}(作用|含义)|报错.{0,12}(原因|什么意思)/;
const TEXT_TRANSFORM =
  /\b(translate|translation|polish|rewrite|summari[sz]e|summary|proofread)\b|翻译|润色|改写|总结|摘要|校对/;
const SIMPLE_QUESTION =
  /^(?:what|who|when|where|why|how)\s+(?:is|are|was|were|does|do|did|can|many|much|long|far)\b|^can you explain\b|是什么|什么是|为什么|怎么(样|办)|如何|多少|几/;
const MULTI_STEP_CODE =
  /\b(plan|steps?|workflow)\b|分步骤|步骤|流程/;

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
}

function isMediaExplanation(prompt: string): boolean {
  return (
    MEDIA_EXPLANATION_PREFIX.test(prompt) ||
    ENGLISH_MEDIA_TUTORIAL_PREFIX.test(prompt)
  );
}

function hasEnglishIndependentMediaAction(prompt: string): boolean {
  for (const boundary of prompt.matchAll(ENGLISH_MEDIA_CLAUSE_BOUNDARY)) {
    const clause = prompt.slice(boundary.index + boundary[0].length);
    const actionClause = clause.replace(ENGLISH_PROJECT_ACTION_PREFIX, "");
    if (ENGLISH_CREATION_CLAUSE.test(actionClause)) {
      return true;
    }
    if (
      (ENGLISH_PROJECT_ADJUSTMENT_CLAUSE.test(actionClause) ||
        ENGLISH_PROJECT_FILE_ACTION_CLAUSE.test(actionClause)) &&
      ENGLISH_PROJECT_INDICATOR.test(clause)
    ) {
      return true;
    }
  }

  return false;
}

function hasChineseIndependentMediaAction(prompt: string): boolean {
  const actionIndex = prompt.search(CHINESE_COORDINATED_MEDIA_ACTION);
  if (actionIndex < 0) {
    return false;
  }

  if (!CHINESE_MEDIA_TUTORIAL_METHOD.test(prompt)) {
    return true;
  }

  return CHINESE_EXPLANATION_CLAUSE.test(prompt.slice(actionIndex + 1));
}

function hasIndependentMediaAction(prompt: string): boolean {
  return (
    hasEnglishIndependentMediaAction(prompt) ||
    hasChineseIndependentMediaAction(prompt)
  );
}

function decision(
  intent: TaskIntent,
  lane: ModelLane,
  executionMode: TaskExecutionMode,
  confidence: RouteConfidence,
  reasonCode: RouteReasonCode,
): RouteDecision {
  return Object.freeze({
    intent,
    lane,
    executionMode,
    confidence,
    reasonCode,
  });
}

export function classifyTask(prompt: string): RouteDecision {
  const normalized = normalizePrompt(prompt);
  const mediaExplanation =
    MEDIA_TOPIC.test(normalized) && isMediaExplanation(normalized);

  if (mediaExplanation && hasIndependentMediaAction(normalized)) {
    return decision(
      "media_script",
      "premium",
      "agentic",
      "high",
      "media-generation",
    );
  }

  if (mediaExplanation) {
    return decision(
      "simple_code",
      "light",
      "read_only",
      "high",
      "code-explanation",
    );
  }

  if (MEDIA_GENERATION.test(normalized)) {
    return decision(
      "media_script",
      "premium",
      "agentic",
      "high",
      "media-generation",
    );
  }

  const chineseMutation =
    CHINESE_PROJECT_MUTATION.test(normalized) &&
    (!CHINESE_EXPLANATION_PREFIX.test(normalized) ||
      CHINESE_FOLLOWED_MUTATION.test(normalized));
  if (ENGLISH_PROJECT_MUTATION.test(normalized) || chineseMutation) {
    return decision(
      "complex_code",
      "premium",
      "agentic",
      "high",
      "project-change",
    );
  }

  if (CODE_EXPLANATION.test(normalized) && MULTI_STEP_CODE.test(normalized)) {
    return decision(
      "complex_code",
      "premium",
      "agentic",
      "medium",
      "multi-step-code",
    );
  }

  if (CODE_EXPLANATION.test(normalized)) {
    return decision(
      "simple_code",
      "light",
      "read_only",
      "high",
      "code-explanation",
    );
  }

  if (TEXT_TRANSFORM.test(normalized)) {
    return decision(
      "simple_text",
      "light",
      "read_only",
      "high",
      "text-transform",
    );
  }

  if (SIMPLE_QUESTION.test(normalized)) {
    return decision(
      "simple_qa",
      "light",
      "read_only",
      "high",
      "simple-question",
    );
  }

  return decision(
    "complex_code",
    "premium",
    "agentic",
    "medium",
    "ambiguous-premium-default",
  );
}
