["(" ")"] @punctuation.bracket

(comment) @comment

(keyword) @keyword
(number) @number
(dash) @operator

(define
  "define" @keyword)

(domain_header
  "domain" @keyword)

(problem_header
  "problem" @keyword)

(goal_and_expression
  "and" @keyword)

(effect_and_expression
  "and" @keyword)

(goal_or_expression
  "or" @keyword)

(goal_not_expression
  "not" @keyword)

(negated_atomic_formula
  "not" @keyword)

(imply_expression
  "imply" @keyword)

(exists_expression
  "exists" @keyword)

(forall_goal_expression
  "forall" @keyword)

(forall_effect_expression
  "forall" @keyword)

(when_expression
  "when" @keyword)

(assign_effect
  [
    "assign"
    "increase"
    "decrease"
    "scale-up"
    "scale-down"
  ] @operator)

(comparison_expression
  [
    ">"
    "<"
    "="
    ">="
    "<="
  ] @operator)

(domain_header
  (name) @module)

(problem_header
  (name) @module)

(domain_reference_section
  (domain_name) @module)

(action_definition
  (action_name) @function.method)

(durative_action_definition
  (action_name) @function.method)

(predicate_definition
  (predicate_name) @function.builtin)

(atomic_formula
  (predicate_name) @function.builtin)

(derived_definition
  (predicate_definition
    (predicate_name) @function.builtin))

(function_definition
  (function_name) @function)

(function_call
  (function_name) @function)

(typed_name_group
  (type_name) @type.builtin)

(function_definition
  (type_name) @type.builtin)

(constant_name) @constant
(object_name) @constant

(parameter) @variable.parameter
(variable) @variable.special

(symbol_name) @constant
(name) @constant
