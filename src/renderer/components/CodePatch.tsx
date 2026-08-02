function lineClass(line: string): string {
  if (
    /^(?:diff --(?:git|cc|combined) |index |--- |\+\+\+ |@{2,3} |new file mode |deleted file mode |old mode |new mode |mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch|\\ No newline at end of file)/.test(
      line,
    )
  ) {
    return "diff-meta";
  }
  if (line.startsWith("+")) {
    return "diff-add";
  }
  if (line.startsWith("-")) {
    return "diff-remove";
  }
  return "diff-context";
}

export function CodePatch({ patch }: { patch: string }) {
  const lines = patch.split("\n");

  return (
    <pre className="diff-output code-patch" aria-label="代码变更">
      <code>
        {lines.map((line, index) => [
          <span className={lineClass(line)} key={`line-${index}`}>
            {line}
          </span>,
          index < lines.length - 1 ? "\n" : null,
        ])}
      </code>
    </pre>
  );
}
