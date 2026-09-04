name: Bug report
description: Report a problem with Guided Web Assistant
title: "[Bug]: "
labels: ["bug"]
body:
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: What did you expect?
  - type: textarea
    id: reproduction
    attributes:
      label: Steps to reproduce
      value: |
        1. ...
        2. ...
        3. ...
    validations:
      required: true
  - type: dropdown
    id: mode
    attributes:
      label: Context mode
      options:
        - DOM_ONLY
        - DOM_PLUS_VISION
        - N/A
  - type: input
    id: browser
    attributes:
      label: Browser and version
      placeholder: "Chrome 116"
  - type: textarea
    id: context
    attributes:
      label: Additional context
