; Blocks world domain
(define (domain blocks)
  (:requirements :strips :typing)
  (:types block)
  (:predicates
    (on ?x ?y - block)
    (ontable ?x - block)
    (clear ?x - block)
    (holding ?x - block)
    (handempty))

  (:action pickup
    :parameters (?x - block)
    :precondition
      (and
        (ontable ?x)
        (clear ?x)
        (handempty))
    :effect
      (and
        (not (ontable ?x))
        (not (clear ?x))
        (not (handempty))
        (holding ?x)))

  (:action putdown
    :parameters (?x - block)
    :precondition
      (holding ?x)
    :effect
      (and
        (ontable ?x)
        (clear ?x)
        (handempty)
        (not (holding ?x))))

  (:action stack
    :parameters (?x ?y - block)
    :precondition
      (and
        (holding ?x)
        (clear ?y))
    :effect
      (and
        (on ?x ?y)
        (clear ?x)
        (handempty)
        (not (holding ?x))
        (not (clear ?y))))

  (:action unstack
    :parameters (?x ?y - block)
    :precondition
      (and
        (on ?x ?y)
        (clear ?x)
        (handempty))
    :effect
      (and
        (holding ?x)
        (clear ?y)
        (not (on ?x ?y))
        (not (clear ?x))
        (not (handempty)))))
