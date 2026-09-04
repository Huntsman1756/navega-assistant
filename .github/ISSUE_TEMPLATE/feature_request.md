name: Feature request
description: Suggest an improvement or new capability
title: "[Feature]: "
labels: ["enhancement"]
body:
  - type: textarea
    id: request
    attributes:
      label: What would you like to add?
    validations:
      required: true
  - type: textarea
    id: why
    attributes:
      label: What problem does it solve?
    validations:
      required: true
  - type: checkboxes
    id: boundary
    attributes:
      label: Product boundary
      options:
        - label: >
            I understand this is a guided-navigation assistant (not an
            autonomous browser agent) and that adding autonomous
            click/type/submit capabilities requires a new threat-model review.
          required: true
